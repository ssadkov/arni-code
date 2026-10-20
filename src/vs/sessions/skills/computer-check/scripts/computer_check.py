#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Bounded read-only system inventory. No network, installation or cleanup."""

import argparse
import base64
from datetime import datetime, timezone
import json
from itertools import islice
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import time

VERSION = "1.0.1"
LIMIT = 150


def run(argv, timeout=20):
    # Fixed argv only; no shell, user-supplied commands, or stderr in reports.
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                            timeout=timeout, encoding="utf-8", errors="replace",
                            env={**os.environ, "LC_ALL": "C", "LANG": "C"})
    if result.returncode:
        raise ValueError("command_failed")
    if len(result.stdout) > 2 * 1024 * 1024:
        raise ValueError("output_limit")
    return result.stdout.lstrip("\ufeff").strip()


def unavailable(error):
    reason = "timeout" if isinstance(error, subprocess.TimeoutExpired) else "unavailable_or_access_denied"
    return {"status": "unavailable", "reason": reason}


def attempt(callback):
    try:
        return {"status": "ok", "data": callback()}
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, plistlib.InvalidFileException) as error:
        return unavailable(error)


def rows(value):
    return value if isinstance(value, list) else [] if value is None else [value]


def text(value):
    return str(value)[:160] if isinstance(value, (str, int, float)) else None


def number(value):
    try:
        result = int(value)
        return result if result >= 0 else None
    except (ValueError, TypeError):
        return None


def disk(name, size, free):
    size, free = number(size), number(free)
    valid = size is not None and free is not None and size > 0 and free <= size
    return {"name": name, "total_bytes": size, "free_bytes": free,
            "free_percent": round(free / size * 100, 1) if valid else None,
            "low_space": free / size < .1 if valid else None}


WINDOWS_QUERY = r"""
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$result=[ordered]@{}
function Section($key, $query) {
    try { $result[$key]=@{status='ok';data=(& $query)} }
    catch { $result[$key]=@{status='unavailable';reason='unavailable_or_access_denied'} }
}
Section 'hardware' { @{computer=(Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory);os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,FreePhysicalMemory);cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors);gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name)} }
Section 'disks' { @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace) }
Section 'processes' { @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 ProcessName,WorkingSet64) }
Section 'startup' { @(Get-CimInstance Win32_StartupCommand | Select-Object -First 150 Name,Location) }
Section 'tasks' { @(Get-ScheduledTask | Where-Object { @($_.Triggers | Where-Object { $_.CimClass.CimClassName -in @('MSFT_TaskBootTrigger','MSFT_TaskLogonTrigger') }).Count -gt 0 } | Select-Object -First 150 TaskName,@{Name='State';Expression={$_.State.ToString()}}) }
Section 'approvals' {
    @(foreach ($scope in @('HKCU','HKLM')) {
        foreach ($kind in @('Run','Run32','StartupFolder')) {
            $source = $scope + ':' + $kind
            $path = $scope + ':\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\' + $kind
            try {
                $key = Get-Item -LiteralPath $path -ErrorAction Stop
                $names = @($key.GetValueNames() | Select-Object -First 151)
                $records = @(foreach ($name in ($names | Select-Object -First 150)) {
                    $value = $key.GetValue($name)
                    $code = $null
                    if ($value -is [byte[]] -and $value.Length -gt 0) { $code = [int]$value[0] }
                    @{name=$name;code=$code}
                })
                @{source=$source;status='ok';truncated=($names.Count -gt 150);records=$records}
            } catch [System.Management.Automation.ItemNotFoundException] {
                @{source=$source;status='absent';records=@()}
            } catch {
                @{source=$source;status='unavailable';records=@()}
            }
        }
    })
}
$result | ConvertTo-Json -Depth 8 -Compress
"""


def windows_approvals(section):
    # These registry flags are hints, not proof of execution or an OS API contract.
    allowed = {scope + ':' + kind for scope in ('HKCU', 'HKLM') for kind in ('Run', 'Run32', 'StartupFolder')}
    coverage = {source: 'unavailable' for source in sorted(allowed)}
    records = []
    if section.get('status') != 'ok':
        return records, coverage
    for group in rows(section.get('data')):
        source = group.get('source')
        if source not in allowed:
            continue
        status = group.get('status')
        coverage[source] = 'bounded' if status == 'ok' and group.get('truncated') else status if status in ('ok', 'absent') else 'unavailable'
        if status != 'ok':
            continue
        for item in rows(group.get('records'))[:LIMIT]:
            code = number(item.get('code'))
            hint = 'enabled_hint' if code in (2, 6) else 'disabled_hint' if code in (3, 7) else 'unknown'
            records.append({'name': text(item.get('name')), 'source': source, 'code': code, 'state_hint': hint})
    return records, coverage


def windows(run_command=run):
    executable = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    encoded = base64.b64encode(WINDOWS_QUERY.encode("utf-16-le")).decode("ascii")
    try:
        raw = json.loads(run_command([str(executable), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], timeout=45))
        if not isinstance(raw, dict):
            raise ValueError("unexpected_inventory")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return {name: unavailable(error) for name in ("hardware", "disks", "processes", "startup")}
    hardware = raw.get("hardware", {})
    if hardware.get("status") == "ok":
        data = hardware["data"]
        computer, os_info = data.get("computer") or {}, data.get("os") or {}
        hardware = {"status": "ok", "data": {
            "manufacturer": text(computer.get("Manufacturer")), "model": text(computer.get("Model")),
            "os": text(os_info.get("Caption")), "os_version": text(os_info.get("Version")),
            "memory_total_bytes": number(computer.get("TotalPhysicalMemory")),
            "memory_available_bytes": (number(os_info.get("FreePhysicalMemory")) or 0) * 1024 if os_info.get("FreePhysicalMemory") is not None else None,
            "cpu": [{"name": text(item.get("Name")), "physical_cores": number(item.get("NumberOfCores")), "logical_cores": number(item.get("NumberOfLogicalProcessors"))} for item in rows(data.get("cpu"))],
            "gpu": [text(item.get("Name")) for item in rows(data.get("gpu"))],
        }}
    else:
        hardware = {"status": "unavailable", "reason": "unavailable_or_access_denied"}
    disks = raw.get("disks", {})
    if disks.get("status") == "ok":
        disks = {"status": "ok", "data": [disk(text(item.get("DeviceID")), item.get("Size"), item.get("FreeSpace")) for item in rows(disks.get("data"))]}
    else:
        disks = {"status": "unavailable", "reason": "unavailable_or_access_denied"}
    processes = raw.get("processes", {})
    if processes.get("status") == "ok":
        processes = {"status": "ok", "data": [{"name": text(item.get("ProcessName")), "memory_bytes": number(item.get("WorkingSet64"))} for item in rows(processes.get("data"))[:8]]}
    else:
        processes = {"status": "unavailable", "reason": "unavailable_or_access_denied"}
    startup = raw.get("startup", {})
    tasks = raw.get("tasks", {})
    items = [{"name": text(item.get("Name")), "source": "Win32_StartupCommand", "state": "configured_enabled_unknown"} for item in rows(startup.get("data"))[:LIMIT]] if startup.get("status") == "ok" else []
    if tasks.get("status") == "ok":
        items += [{"name": text(item.get("TaskName")), "source": "boot_logon_task", "state": text(item.get("State"))} for item in rows(tasks.get("data"))[:LIMIT]]
    coverage = {"Win32_StartupCommand": startup.get("status", "unavailable"), "boot_logon_tasks": tasks.get("status", "unavailable")}
    approvals, approval_coverage = windows_approvals(raw.get('approvals') or {})
    return {"hardware": hardware, "disks": disks, "processes": processes,
            "startup": {"status": "partial", "data": items, "coverage": coverage,
                        "approval_records": approvals, "approval_coverage": approval_coverage,
                        "limit_per_source": LIMIT, "not_checked": ["modern_startup_registrations", "all_users_and_services", "effective_startup_execution", "other_users_startup_approval"]}}


def mac_hardware(run_command):
    raw = json.loads(run_command(["/usr/sbin/system_profiler", "-json", "-detailLevel", "mini", "SPHardwareDataType", "SPDisplaysDataType"]))
    hardware = rows(raw.get("SPHardwareDataType"))
    if not hardware:
        raise ValueError("hardware_unavailable")
    item = hardware[0]
    read = lambda key: run_command(["/usr/sbin/sysctl", "-n", key])
    return {"manufacturer": "Apple", "model": text(item.get("machine_name")), "model_identifier": text(item.get("machine_model")),
            "os": "macOS", "os_version": run_command(["/usr/bin/sw_vers", "-productVersion"]),
            "cpu": [{"name": text(item.get("chip_type") or item.get("cpu_type")), "physical_cores": number(read("hw.physicalcpu")), "logical_cores": number(read("hw.logicalcpu"))}],
            "memory_total_bytes": number(read("hw.memsize")),
            "gpu": [text(row.get("sppci_model") or row.get("_name")) for row in rows(raw.get("SPDisplaysDataType"))]}


def parse_df(output, role):
    lines = output.splitlines()
    if len(lines) != 2:
        raise ValueError("unexpected_df")
    parts = lines[1].split(None, 5)
    if len(parts) != 6:
        raise ValueError("unexpected_df")
    return disk(role, int(parts[1]) * 1024, int(parts[3]) * 1024)


def mac_processes(run_command):
    output = run_command(["/bin/ps", "-axo", "rss=,comm="])
    result = []
    for line in output.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            result.append({"name": Path(parts[1]).name, "memory_bytes": int(parts[0]) * 1024})
    return sorted(result, key=lambda row: row["memory_bytes"], reverse=True)[:8]


def mac_startup(run_command, roots=None):
    roots = roots if roots is not None else [("user_agents", Path.home() / "Library/LaunchAgents"), ("shared_agents", Path("/Library/LaunchAgents")), ("system_daemons", Path("/Library/LaunchDaemons"))]
    try:
        output = run_command(["/bin/launchctl", "list"])
        loaded = {parts[2] for line in output.splitlines()[1:] if len(parts := line.split(None, 2)) == 3}
    except (OSError, ValueError, subprocess.SubprocessError):
        loaded = None
    coverage = {"current_user_launchctl": "ok" if loaded is not None else "unavailable"}
    items = []
    skipped = 0
    for source, root in roots:
        try:
            try:
                root.stat()
            except FileNotFoundError:
                coverage[source] = "absent"
                continue
            candidates = sorted(islice(root.glob("*.plist"), LIMIT + 1))
            coverage[source] = "bounded" if len(candidates) > LIMIT else "ok"
            for file in candidates[:LIMIT]:
                try:
                    if file.is_symlink() or file.stat().st_size > 256 * 1024:
                        skipped += 1
                        continue
                    with file.open("rb") as handle:
                        data = plistlib.load(handle)
                    label = data.get("Label")
                    if not isinstance(label, str):
                        skipped += 1
                        continue
                    # launchctl's current-user domain says nothing about system daemons.
                    state = "unknown" if loaded is None or source == "system_daemons" else "loaded_in_user_domain" if label in loaded else "not_loaded_in_user_domain"
                    items.append({"name": label[:160], "source": source, "state": state,
                                  "run_at_load_hint": data.get("RunAtLoad") is True,
                                  "keep_alive_hint": bool(data.get("KeepAlive"))})
                except (OSError, ValueError, TypeError, AttributeError, plistlib.InvalidFileException):
                    skipped += 1
        except OSError:
            coverage[source] = "unavailable"
    return {"status": "partial", "data": items, "coverage": coverage, "skipped": skipped,
            "limit_per_source": LIMIT, "not_checked": ["modern_login_items_and_background_registrations", "other_user_domains", "enabled_state"]}


def mac(run_command=run):
    volumes = {role: attempt(lambda path=path, role=role: parse_df(run_command(["/bin/df", "-kP", path]), role)) for role, path in (("system", "/"), ("data", "/System/Volumes/Data"))}
    return {"hardware": attempt(lambda: mac_hardware(run_command)),
            "disks": {"status": "partial" if any(value["status"] != "ok" for value in volumes.values()) else "ok", "volumes": volumes, "shared_apfs_space_do_not_sum": True},
            "processes": attempt(lambda: mac_processes(run_command)),
            "startup": mac_startup(run_command)}


def redact(value, home=None):
    if isinstance(value, dict):
        return {key: redact(item, home) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, home) for item in value]
    if not isinstance(value, str):
        return value
    home = str(Path.home()) if home is None else home
    value = re.sub(re.escape(home), "<home>", value, flags=re.I) if home else value
    value = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "<email>", value)
    value = re.sub(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", "<id>", value, flags=re.I)
    value = re.sub(r"\bS-\d+-\d+(?:-\d+)+\b", "<sid>", value, flags=re.I)
    return re.sub(r"[\x00-\x1f\x7f]", " ", value)[:200]


def check(system=None, run_command=run):
    started = time.monotonic()
    system = platform.system() if system is None else system
    if system == "Windows":
        sections = windows(run_command)
    elif system == "Darwin":
        sections = mac(run_command)
    else:
        sections = {"hardware": {"status": "unavailable", "reason": "unsupported_platform"}}
    return redact({"schema_version": 1, "helper_version": VERSION, "mode": "read_only",
                   "platform": system, "architecture": platform.machine(),
                   "collected_at": datetime.now(timezone.utc).isoformat(),
                   "elapsed_seconds": round(time.monotonic() - started, 2), "sections": sections,
                   "privacy": "Selected hardware and app/service names only. No document contents, serial/account/host fields or process arguments collected. Labels may still identify installed software or personal information; this report is not anonymous.",
                   "limitations": ["No cleanup or startup changes", "Startup coverage is partial", "A snapshot is not a performance benchmark, malware scan or SSD health test"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "capabilities"])
    parser.add_argument("--output", type=Path, help="Save a new JSON report; never overwrite")
    args = parser.parse_args()
    if args.command == "capabilities":
        report = {"helper_version": VERSION, "mode": "description_only", "platforms": ["Windows", "macOS"],
                  "capabilities": ["hardware_and_os", "disk_free_space", "top_memory_processes", "partial_startup_inventory"],
                  "not_supported": ["cleanup", "startup_changes", "installation", "malware_or_ssd_health_scan", "document_scan"]}
    else:
        report = check()
    # Compact ASCII JSON avoids code-page failures and unnecessary tool-output paging.
    output = json.dumps(report, ensure_ascii=True, separators=(",", ":")) + "\n"
    if args.output:
        with args.output.open("x", encoding="utf-8") as handle:
            handle.write(output)
    print(output, end="")
    return 0 if args.command == "capabilities" or report["sections"].get("hardware", {}).get("status") == "ok" else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "failed", "reason": type(error).__name__, "instruction": "No system changes performed; choose a new writable report file or inspect unavailable sections."}), file=sys.stderr)
        sys.exit(2)
