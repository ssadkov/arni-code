# When Python is unavailable

These are limited read-only fallback checks, not the full helper report. Explain which output will be returned to the model. Do not install Python as a side effect of checking the computer. Never replace these commands with a broad `systeminfo`, raw system_profiler, registry dump, environment listing or process command-line dump.

Windows PowerShell (no administrator required; denied queries stay unavailable):

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory | ConvertTo-Json -Compress
Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress
```

On macOS, `sw_vers -productVersion`, `uname -m`, `sysctl -n machdep.cpu.brand_string`, `sysctl -n hw.memsize`, `sysctl -n hw.physicalcpu`, `sysctl -n hw.logicalcpu`, and `df -kP /` provide a small hardware/space subset. Do not run a command that prompts for developer tools or automation access. Leave GPU/model/startup unavailable in this fallback; direct the user to System Settings → General → Login Items & Extensions if needed. The fallback does not claim a full check.

Primary references: [Windows startup inventory](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-startupcommand), [computer properties](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystem), [Windows startup settings](https://support.microsoft.com/en-us/windows/experience/startup-boot/configure-startup-applications-in-windows), [Mac login items](https://support.apple.com/en-gb/guide/mac-help/-mtusr003/mac), [Apple launchctl documentation](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchctl.1). A plist Disabled flag is only a hint; it does not prove the current launchd state.
