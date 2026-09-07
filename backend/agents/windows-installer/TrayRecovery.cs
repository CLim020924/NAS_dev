using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Threading;

namespace NasDriveSetup
{
    // Only an acknowledged UI-loop request is evidence of a healthy tray.
    internal static class TrayRecovery
    {
        internal const string MutexName = "Local\\NAS-Drive-Native-Tray-SingleInstance";
        internal const string AckName = "Local\\NAS-Drive-Native-Tray-Ack";
        private const string RecoveryName = "Local\\NAS-Drive-Native-Tray-Recovery";

        private static bool Take(Mutex mutex, int timeout)
        {
            try { return mutex.WaitOne(timeout); }
            catch (AbandonedMutexException) { return true; }
        }

        internal static Mutex Acquire(string refreshName, string mutexName = MutexName,
            string ackName = AckName, string recoveryName = RecoveryName)
        {
            using (var recovery = new Mutex(false, recoveryName))
            {
                if (!Take(recovery, 15000)) throw new TimeoutException("TRAY_RECOVERY_BUSY");
                try
                {
                    var tray = new Mutex(false, mutexName);
                    if (Take(tray, 0)) return tray;
                    DateTime probeStartedAt = DateTime.UtcNow;
                    // Keep the handle alive while replacing the old owner, then
                    // acquire ownership (createdNew is NOT an ownership test).
                    using (var ack = new EventWaitHandle(false, EventResetMode.AutoReset, ackName))
                    {
                        ack.Reset();
                        try
                        {
                            using (var refresh = EventWaitHandle.OpenExisting(refreshName)) refresh.Set();
                        }
                        catch (WaitHandleCannotBeOpenedException) { }
                        if (ack.WaitOne(8000)) { tray.Dispose(); return null; }
                    }
                    StopUnresponsiveTrayOwners(ApplicationPath(), probeStartedAt);
                    if (Take(tray, 3000)) return tray;
                    tray.Dispose();
                    throw new TimeoutException("TRAY_RECOVERY_FAILED");
                }
                finally { recovery.ReleaseMutex(); }
            }
        }

        private static string ApplicationPath()
        {
            return System.Windows.Forms.Application.ExecutablePath;
        }

        internal static bool IsBackgroundCommand(string command)
        {
            // Our launcher emits exactly one argument for this role. Never
            // replace an installer, picker, foreground UI or notification.
            if (string.IsNullOrWhiteSpace(command)) return false;
            return System.Text.RegularExpressions.Regex.IsMatch(command.Trim(),
                "^(?:\"[^\"]+\"|\\S+)\\s+--background$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }

        private static void StopUnresponsiveTrayOwners(string launcher, DateTime probeStartedAt)
        {
            using (Process current = Process.GetCurrentProcess())
            using (var query = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='NAS-Drive.exe'"))
            using (var owners = query.Get())
            {
                foreach (ManagementObject owner in owners)
                using (owner)
                {
                    if (!IsBackgroundCommand(Convert.ToString(owner["CommandLine"]))) continue;
                    try
                    {
                        using (Process process = Process.GetProcessById(Convert.ToInt32(owner["ProcessId"])))
                        {
                            if (process.Id == current.Id || process.SessionId != current.SessionId || process.HasExited) continue;
                            if (!Program.IsInstalledLauncherProcessPath(process.MainModule.FileName, launcher)) continue;
                            // Do not race a freshly launched tray. It may be waiting
                            // for this recovery lock and owns no old UI state.
                            if (process.StartTime.ToUniversalTime() >= probeStartedAt) continue;
                            process.Kill();
                            process.WaitForExit(2000);
                        }
                    }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                }
            }
        }
    }
}
