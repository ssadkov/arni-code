# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Privacy, partial-source and native checks for the read-only computer helper."""
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "src/vs/sessions/skills/computer-check/scripts/computer_check.py"
spec = importlib.util.spec_from_file_location("computer_check", HELPER)
skill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skill)


class ComputerCheckTest(unittest.TestCase):
    def test_windows_allowlist_omits_serials_accounts_paths_and_arguments(self):
        fixture = {
            "hardware": {"status": "ok", "data": {
                "computer": {"Manufacturer": "Example", "Model": "Laptop", "TotalPhysicalMemory": 16 * 1024**3, "UserName": "ACCOUNT-SENTINEL", "SerialNumber": "SERIAL-SENTINEL"},
                "os": {"Caption": "Windows", "Version": "11", "FreePhysicalMemory": 1000, "RegisteredUser": "OWNER-SENTINEL"},
                "cpu": {"Name": "CPU", "NumberOfCores": 4, "NumberOfLogicalProcessors": 8, "ProcessorId": "CPU-ID-SENTINEL"},
                "gpu": [{"Name": "GPU", "PNPDeviceID": "DEVICE-ID-SENTINEL"}]}},
            "disks": {"status": "ok", "data": {"DeviceID": "C:", "Size": 100 * 1024**3, "FreeSpace": 5 * 1024**3, "VolumeName": "PRIVATE-VOLUME-SENTINEL"}},
            "processes": {"status": "ok", "data": [{"ProcessName": "Editor", "WorkingSet64": 1000, "Path": "PRIVATE-PATH-SENTINEL", "CommandLine": "PASSWORD-SENTINEL"}]},
            "startup": {"status": "ok", "data": [{"Name": "Updater", "Command": "TOKEN-SENTINEL", "Location": "HOME-PATH-SENTINEL", "UserSID": "SID-SENTINEL"}]},
            "tasks": {"status": "unavailable", "reason": "unavailable_or_access_denied"},
        }
        calls = []
        def run(argv, timeout):
            calls.append(argv)
            return json.dumps(fixture)
        report = skill.check("Windows", run)
        serialized = json.dumps(report)
        self.assertNotIn("SENTINEL", serialized)
        self.assertEqual(len(calls), 1)
        self.assertIn("-NonInteractive", calls[0])
        data = report["sections"]
        self.assertEqual(data["hardware"]["data"]["cpu"][0]["logical_cores"], 8)
        self.assertTrue(data["disks"]["data"][0]["low_space"])
        self.assertEqual(data["startup"]["coverage"]["boot_logon_tasks"], "unavailable")
        self.assertEqual(data["startup"]["data"][0]["state"], "configured_enabled_unknown")

    def test_timeout_does_not_leak_error_output_or_claim_empty_inventory(self):
        def fail(argv, timeout):
            raise subprocess.TimeoutExpired(argv, timeout, output="PRIVATE-SENTINEL", stderr="TOKEN-SENTINEL")
        report = skill.check("Windows", fail)
        self.assertNotIn("SENTINEL", json.dumps(report))
        self.assertTrue(all(section["status"] == "unavailable" for section in report["sections"].values()))

    def test_windows_startup_hints_keep_scope_unknown_codes_and_coverage(self):
        fixture = {'approvals': {'status': 'ok', 'data': [
            {'source': 'HKCU:Run', 'status': 'ok', 'records': [
                {'name': 'Same app', 'code': 3, 'Command': 'PRIVATE-SENTINEL'},
                {'name': 'Unspecified', 'code': 1}, {'name': 'Other', 'code': None}]},
            {'source': 'HKLM:Run', 'status': 'ok', 'records': [{'name': 'Same app', 'code': 2}]},
            {'source': 'HKCU:Run32', 'status': 'absent', 'records': []},
            {'source': 'HKLM:Run32', 'status': 'unavailable', 'records': []},
            {'source': 'OTHER-PRIVATE-SENTINEL', 'status': 'ok', 'records': [{'name': 'PRIVATE-SENTINEL', 'code': 2}]},
        ]}}
        report = skill.check('Windows', lambda argv, **kwargs: json.dumps(fixture))
        startup = report['sections']['startup']
        self.assertEqual([(row['source'], row['state_hint']) for row in startup['approval_records']], [
            ('HKCU:Run', 'disabled_hint'), ('HKCU:Run', 'unknown'), ('HKCU:Run', 'unknown'), ('HKLM:Run', 'enabled_hint')])
        self.assertEqual(startup['approval_coverage']['HKCU:Run32'], 'absent')
        self.assertEqual(startup['approval_coverage']['HKLM:Run32'], 'unavailable')
        self.assertEqual(startup['approval_coverage']['HKCU:StartupFolder'], 'unavailable')
        self.assertIn('effective_startup_execution', startup['not_checked'])
        self.assertNotIn('SENTINEL', json.dumps(report))

    def test_windows_startup_hints_are_bounded_and_unavailable_is_not_empty_success(self):
        records, coverage = skill.windows_approvals({'status': 'ok', 'data': [
            {'source': 'HKCU:StartupFolder', 'status': 'ok', 'truncated': True,
             'records': [{'name': str(i), 'code': 6} for i in range(skill.LIMIT + 1)]}]})
        self.assertEqual(len(records), skill.LIMIT)
        self.assertEqual(coverage['HKCU:StartupFolder'], 'bounded')
        self.assertTrue(all(row['state_hint'] == 'enabled_hint' for row in records))
        records, coverage = skill.windows_approvals({'status': 'unavailable'})
        self.assertEqual(records, [])
        self.assertTrue(all(status == 'unavailable' for status in coverage.values()))

    def test_macos_hardware_df_and_process_fixture(self):
        fixtures = {
            "/usr/sbin/system_profiler": json.dumps({"SPHardwareDataType": [{"machine_name": "MacBook Air", "machine_model": "Mac16,1", "chip_type": "Apple M4", "serial_number": "SERIAL-SENTINEL", "platform_UUID": "UUID-SENTINEL"}], "SPDisplaysDataType": [{"sppci_model": "Apple M4", "displays": [{"serial": "DISPLAY-SENTINEL"}]}]}),
            "/usr/bin/sw_vers": "15.0",
        }
        def run(argv, **kwargs):
            if argv[0] == "/usr/sbin/sysctl":
                return str({"hw.physicalcpu": 10, "hw.logicalcpu": 10, "hw.memsize": 24 * 1024**3}[argv[-1]])
            return fixtures[argv[0]]
        hardware = skill.mac_hardware(run)
        self.assertNotIn("SENTINEL", json.dumps(hardware))
        self.assertEqual(hardware["cpu"][0]["name"], "Apple M4")
        self.assertEqual(hardware["memory_total_bytes"], 24 * 1024**3)
        df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3 1000 400 500 44% /System/Volumes/Data\n"
        self.assertEqual(skill.parse_df(df, "data")["free_bytes"], 500 * 1024)
        with self.assertRaises(ValueError):
            skill.parse_df("garbled output", "system")
        processes = skill.mac_processes(lambda argv: " 20 /Applications/My App.app/Contents/MacOS/App\n100 /usr/bin/python3\n")
        self.assertEqual(processes, [{"name": "python3", "memory_bytes": 102400}, {"name": "App", "memory_bytes": 20480}])

    def test_macos_plists_do_not_execute_jobs_or_treat_disabled_as_current_state(self):
        with tempfile.TemporaryDirectory(prefix="computer-check-test-", dir=ROOT / ".build") as directory:
            root = Path(directory)
            for name, label in [("user", "example.loaded"), ("daemon", "example.daemon")]:
                (root / name).mkdir()
                with (root / name / "app.plist").open("wb") as handle:
                    plistlib.dump({"Label": label, "Disabled": True, "RunAtLoad": True, "ProgramArguments": ["TOKEN-SENTINEL"], "UserName": "USER-SENTINEL"}, handle)
            (root / "user" / "broken.plist").write_text("invalid")
            roots = [("user_agents", root / "user"), ("system_daemons", root / "daemon"), ("shared_agents", root / "missing")]
            commands = []
            def run(argv):
                commands.append(argv)
                return "PID\tStatus\tLabel\n-\t0\texample.loaded\n"
            report = skill.mac_startup(run, roots)
            self.assertEqual(commands, [["/bin/launchctl", "list"]])
            self.assertNotIn("SENTINEL", json.dumps(report))
            self.assertEqual([item["state"] for item in report["data"]], ["loaded_in_user_domain", "unknown"])
            self.assertEqual(report["skipped"], 1)
            self.assertEqual(report["coverage"]["shared_agents"], "absent")
            self.assertIn("enabled_state", report["not_checked"])

    def test_redaction_and_invalid_disk_values(self):
        sample = {"items": [r"C:\Users\Example\secret", "person@example.test", "00112233-4455-6677-8899-aabbccddeeff", "line\nlabel", "Task-S-1-5-21-111111-222222-333333-1001", "s-1-5-18"]}
        redacted = skill.redact(sample, r"C:\Users\Example")
        self.assertEqual(redacted["items"], [r"<home>\secret", "<email>", "<id>", "line label", "Task-<sid>", "<sid>"])
        self.assertIsNone(skill.disk("bad", 0, 5)["low_space"])
        self.assertIsNone(skill.disk("bad", 10, 11)["free_percent"])
        self.assertFalse(skill.disk("small_volume", 8 * 1024**3, 2 * 1024**3)["low_space"])

    def test_capabilities_does_not_collect_or_overwrite_files(self):
        with patch.object(sys, "argv", [str(HELPER), "capabilities"]), patch.object(skill, "check") as collect, patch("builtins.print"):
            self.assertEqual(skill.main(), 0)
            collect.assert_not_called()
        with tempfile.TemporaryDirectory(prefix="computer-check-test-", dir=ROOT / ".build") as directory:
            path = Path(directory) / "report.json"
            result = subprocess.run([sys.executable, str(HELPER), "capabilities", "--output", str(path)], capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0)
            before = path.read_bytes()
            result = subprocess.run([sys.executable, str(HELPER), "capabilities", "--output", str(path)], capture_output=True, text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

    def test_compact_json_preserves_unicode_and_redacts_task_sids(self):
        fixture = {'tasks': {'status': 'ok', 'data': [{'TaskName': 'Задача-S-1-5-21-111-222-333-1001', 'State': 'Ready'}]}}
        report = skill.check('Windows', lambda argv, **kwargs: json.dumps(fixture))
        with patch.object(sys, 'argv', [str(HELPER), 'check']), patch.object(skill, 'check', return_value=report), patch('builtins.print') as output:
            skill.main()
        emitted = output.call_args.args[0]
        self.assertEqual(len(emitted.splitlines()), 1)
        self.assertEqual(json.loads(emitted), report)
        self.assertEqual(report['sections']['startup']['data'][0]['name'], 'Задача-<sid>')

    @unittest.skipUnless(os.environ.get("ARNI_TEST_NATIVE") == "1", "Native system inventory is explicitly opted in")
    def test_native_inventory(self):
        report = skill.check()
        self.assertEqual(report["platform"], platform.system())
        self.assertEqual(report["sections"]["hardware"]["status"], "ok")
        self.assertEqual(report["sections"]["disks"]["status"], "ok")
        self.assertGreater(report["sections"]["hardware"]["data"]["memory_total_bytes"], 0)
        self.assertTrue(report["sections"]["hardware"]["data"]["cpu"])
        if platform.system() == 'Windows':
            self.assertEqual(len(report['sections']['startup']['approval_coverage']), 6)
            self.assertTrue(any(state in ('ok', 'absent', 'bounded') for state in report['sections']['startup']['approval_coverage'].values()))
        print("Native computer-check passed for " + platform.system() + "; private inventory omitted from test output.")


if __name__ == "__main__":
    (ROOT / ".build").mkdir(exist_ok=True)
    unittest.main()
