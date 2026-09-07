// Compiled separately with TrayRecovery.cs, never embedded in the installer.
using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

namespace NasDriveSetup
{
    internal static class Program
    {
        internal static bool IsInstalledLauncherProcessPath(string actual, string expected)
        { return string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase); }

        [STAThread]
        private static int Main(string[] args)
        {
            string prefix = Environment.GetEnvironmentVariable("NAS_TRAY_TEST_PREFIX");
            if (args.Length == 1 && args[0] == "--background")
            {
                using (var mutex = new Mutex(true, prefix + "mutex"))
                using (var ready = EventWaitHandle.OpenExisting(prefix + "ready"))
                using (var refresh = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + "refresh"))
                using (var ack = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + "ack"))
                {
                    ready.Set();
                    while (true)
                    {
                        refresh.WaitOne();
                        if (Environment.GetEnvironmentVariable("NAS_TRAY_TEST_MODE") == "responsive") ack.Set();
                    }
                }
            }
            prefix = "Local\\NAS-Drive-Test-" + Guid.NewGuid().ToString("N");
            using (var ready = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + "ready"))
            {
                foreach (string mode in new[] { "responsive", "hung" })
                {
                    var start = new ProcessStartInfo(Application.ExecutablePath, "--background")
                    { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                    start.EnvironmentVariables["NAS_TRAY_TEST_PREFIX"] = prefix;
                    start.EnvironmentVariables["NAS_TRAY_TEST_MODE"] = mode;
                    using (var child = Process.Start(start))
                    {
                        try
                        {
                            if (!ready.WaitOne(5000)) throw new Exception("fixture timeout");
                            using (var owned = TrayRecovery.Acquire(prefix + "refresh", prefix + "mutex", prefix + "ack", prefix + "recovery"))
                            {
                                if (mode == "responsive" && (owned != null || child.HasExited)) throw new Exception("healthy tray replaced");
                                if (mode == "hung" && (owned == null || !child.HasExited)) throw new Exception("hung tray not recovered");
                                if (owned != null) owned.ReleaseMutex();
                            }
                            Console.WriteLine(mode + " recovery passed");
                        }
                        finally { if (!child.HasExited) { child.Kill(); child.WaitForExit(3000); } }
                    }
                }
                using (var owned = TrayRecovery.Acquire(prefix + "refresh", prefix + "mutex", prefix + "ack", prefix + "recovery"))
                {
                    if (owned == null) throw new Exception("clean restart failed");
                    owned.ReleaseMutex();
                }
                Console.WriteLine("clean restart passed");
            }
            return 0;
        }
    }
}
