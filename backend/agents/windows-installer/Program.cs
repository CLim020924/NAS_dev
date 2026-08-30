using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: AssemblyTitle("NAS Drive Setup")]
[assembly: AssemblyDescription("Windows installer for NAS Drive")]
[assembly: AssemblyCompany("NAS Drive")]
[assembly: AssemblyProduct("NAS Drive")]
[assembly: AssemblyVersion("1.10.19.0")]
[assembly: AssemblyFileVersion("1.10.19.0")]

namespace NasDriveSetup
{
    internal static class Program
    {
        internal const string ProductVersion = "1.10.19";
        private const string ShutdownMutexName = "Local\\NAS-Drive-Background-Shutdown";
        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int command);
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        internal static Font UiFont(string family, float pointSize)
        {
            return new Font(family, pointSize * 96f / 72f, FontStyle.Regular, GraphicsUnit.Pixel);
        }

        [STAThread]
        private static void Main(string[] args)
        {
            if (Array.Exists(args, item => string.Equals(item, "--cleanup-installers", StringComparison.OrdinalIgnoreCase)))
            {
                RunDeferredInstallerCleanup(args);
                return;
            }
            if (Array.Exists(args, item => string.Equals(item, "--self-test", StringComparison.OrdinalIgnoreCase)))
            {
                Environment.Exit(RunSelfTest() ? 0 : 1);
                return;
            }
            if (RunInstalledAgentCommand(args)) return;
            bool created;
            using (var mutex = new Mutex(true, "Local\\NAS-Drive-Setup-SingleInstance", out created))
            {
                if (!created)
                {
                    FocusExistingLauncherWindow("NAS Drive 설치");
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new InstallerForm());
            }
        }

        private static void RunDeferredInstallerCleanup(string[] args)
        {
            string sourcePath = "";
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], "--cleanup-installers", StringComparison.OrdinalIgnoreCase)) sourcePath = args[i + 1];
            }
            if (string.IsNullOrWhiteSpace(sourcePath)) return;
            Thread.Sleep(2200);
            try
            {
                string downloads = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")).TrimEnd(Path.DirectorySeparatorChar);
                string source = Path.GetFullPath(sourcePath);
                string sourceDirectory = Path.GetDirectoryName(source).TrimEnd(Path.DirectorySeparatorChar);
                if (!string.Equals(sourceDirectory, downloads, StringComparison.OrdinalIgnoreCase)) return;
                foreach (string file in Directory.GetFiles(downloads, "*.exe", SearchOption.TopDirectoryOnly))
                {
                    if (!IsKnownInstallerFileName(Path.GetFileName(file))) continue;
                    try { File.Delete(file); } catch { }
                }
            }
            catch { }
        }

        internal static bool IsKnownInstallerFileName(string fileName)
        {
            return Regex.IsMatch(fileName ?? "", @"^NAS-Drive-Setup(?:_pair_[A-Za-z0-9_-]+)?(?: \(\d+\))?\.exe$", RegexOptions.IgnoreCase)
                || Regex.IsMatch(fileName ?? "", @"^NAS-Sync-Agent_pair_[A-Za-z0-9_-]+(?: \(\d+\))?\.exe$", RegexOptions.IgnoreCase);
        }

        internal static bool IsInstalledLauncherProcessPath(string processPath, string launcherPath)
        {
            if (string.IsNullOrWhiteSpace(processPath) || string.IsNullOrWhiteSpace(launcherPath)) return false;
            return string.Equals(processPath, launcherPath, StringComparison.OrdinalIgnoreCase)
                || string.Equals(processPath, launcherPath + ".previous", StringComparison.OrdinalIgnoreCase);
        }

        internal static bool IsInstalledAgentProcessPath(string processPath, string agentPath)
        {
            if (string.IsNullOrWhiteSpace(processPath) || string.IsNullOrWhiteSpace(agentPath)) return false;
            try
            {
                return string.Equals(Path.GetFullPath(processPath), Path.GetFullPath(agentPath), StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private static bool RunInstalledAgentCommand(string[] args)
        {
            string protocolUrl = "";
            bool background = false;
            bool open = false;
            bool openWeb = false;
            bool login = false;
            bool shutdownBackground = false;
            string notificationPayload = "";
            for (int index = 0; index < args.Length; index++)
            {
                string arg = args[index];
                if (arg.StartsWith("nas-sync://", StringComparison.OrdinalIgnoreCase)) protocolUrl = arg;
                if (string.Equals(arg, "--background", StringComparison.OrdinalIgnoreCase)) background = true;
                if (string.Equals(arg, "--open", StringComparison.OrdinalIgnoreCase)) open = true;
                if (string.Equals(arg, "--open-web", StringComparison.OrdinalIgnoreCase)) openWeb = true;
                if (string.Equals(arg, "--login", StringComparison.OrdinalIgnoreCase)) login = true;
                if (string.Equals(arg, "--shutdown-background", StringComparison.OrdinalIgnoreCase)) shutdownBackground = true;
                if (string.Equals(arg, "--notify-base64", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length) notificationPayload = args[++index];
            }
            if (protocolUrl.StartsWith("nas-sync://open-web", StringComparison.OrdinalIgnoreCase)) openWeb = true;
            if (!string.IsNullOrWhiteSpace(notificationPayload))
            {
                ShowNativeNotification(notificationPayload);
                return true;
            }
            if (string.IsNullOrWhiteSpace(protocolUrl) && !background && !open && !openWeb && !login && !shutdownBackground) return false;

            string installedExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "NAS Drive", "NAS-Sync-Agent.exe");
            if (!File.Exists(installedExe))
            {
                if (!background) MessageBox.Show("NAS Drive Agent가 설치되어 있지 않습니다. 설치 프로그램을 다시 실행해주세요.", "NAS Drive", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return true;
            }

            if (!shutdownBackground) WaitForBackgroundShutdown();

            if (shutdownBackground)
            {
                StopInstalledBackgroundProcesses(installedExe);
                return true;
            }

            if (openWeb)
            {
                OpenWebWithBrowserPicker(installedExe);
                return true;
            }

            if (open || login)
            {
                bool created;
                using (var uiMutex = new Mutex(true, "Local\\NAS-Drive-Control-Center-SingleInstance", out created))
                {
                    if (!created)
                    {
                        FocusExistingLauncherWindow("NAS Drive");
                        return true;
                    }
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    bool hasConfiguredProfile = NativeControlCenter.HasConfiguredProfile();
                    if (open && hasConfiguredProfile) StartBackgroundLauncher();
                    if (login || !hasConfiguredProfile) Application.Run(new NativeLoginForm(installedExe));
                    else Application.Run(new NativeControlCenter(installedExe));
                }
                return true;
            }

            if (background)
            {
                if (NativeControlCenter.HasConfiguredProfile()) StartInstalledAgent(installedExe, "--background");
                bool created;
                using (var trayMutex = new Mutex(true, "Local\\NAS-Drive-Native-Tray-SingleInstance", out created))
                {
                    if (!created) return true;
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new NativeTrayContext(installedExe));
                }
                return true;
            }

            string agentArgs = QuoteArgument(protocolUrl) + " --hidden-bootstrap";
            Process.Start(new ProcessStartInfo(installedExe, agentArgs)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(installedExe)
            });
            return true;
        }

        private static bool FocusExistingLauncherWindow(string expectedTitle)
        {
            string launcherPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "NAS Drive", "NAS-Drive.exe");
            foreach (Process process in Process.GetProcessesByName("NAS-Drive"))
            {
                try
                {
                    if (process.Id == Process.GetCurrentProcess().Id || process.HasExited || process.MainWindowHandle == IntPtr.Zero) continue;
                    if (!IsInstalledLauncherProcessPath(process.MainModule.FileName, launcherPath)) continue;
                    if (!string.Equals(process.MainWindowTitle, expectedTitle, StringComparison.OrdinalIgnoreCase)) continue;
                    ShowWindow(process.MainWindowHandle, 9);
                    SetForegroundWindow(process.MainWindowHandle);
                    return true;
                }
                catch { }
                finally { process.Dispose(); }
            }
            return false;
        }

        internal static void StopInstalledBackgroundProcesses(string installedAgentExe)
        {
            bool created;
            using (var shutdownMutex = new Mutex(true, ShutdownMutexName, out created))
            {
                if (!created)
                {
                    try { shutdownMutex.WaitOne(15000); shutdownMutex.ReleaseMutex(); } catch (AbandonedMutexException) { }
                    return;
                }
                try { StopInstalledBackgroundProcessesCore(installedAgentExe); }
                finally { try { shutdownMutex.ReleaseMutex(); } catch { } }
            }
        }

        private static void StopInstalledBackgroundProcessesCore(string installedAgentExe)
        {
            string stateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent");
            string providerExe = Path.Combine(Path.GetDirectoryName(installedAgentExe), "NAS-Drive-Provider.exe");
            string launcherExe = Path.Combine(Path.GetDirectoryName(installedAgentExe), "NAS-Drive.exe");
            List<int> agentPids = CaptureExactProcessIds("NAS-Sync-Agent", installedAgentExe);
            List<int> providerPids = CaptureExactProcessIds("NAS-Drive-Provider", providerExe);
            List<int> launcherPids = CaptureExactProcessIds("NAS-Drive", launcherExe);
            try { Directory.CreateDirectory(stateDir); File.WriteAllText(Path.Combine(stateDir, "agent.exit"), DateTime.UtcNow.Ticks.ToString()); } catch { }

            DateTime deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                bool agentRunning = false;
                foreach (Process process in Process.GetProcessesByName("NAS-Sync-Agent"))
                {
                    try
                    {
                        if (!process.HasExited && IsInstalledAgentProcessPath(process.MainModule.FileName, installedAgentExe)) agentRunning = true;
                    }
                    catch { }
                    finally { process.Dispose(); }
                }
                if (!agentRunning) break;
                Thread.Sleep(250);
            }

            StopCapturedProcesses(agentPids, installedAgentExe);
            StopCapturedProcesses(providerPids, providerExe);
            StopCapturedProcesses(launcherPids, launcherExe);
            try { File.Delete(Path.Combine(stateDir, "agent.pid")); } catch { }
            try { File.Delete(Path.Combine(stateDir, "agent.exit")); } catch { }
        }

        private static void WaitForBackgroundShutdown()
        {
            string exitMarker = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent", "agent.exit");
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    using (Mutex mutex = Mutex.OpenExisting(ShutdownMutexName))
                    {
                        int remaining = Math.Max(1, (int)(deadline - DateTime.UtcNow).TotalMilliseconds);
                        try
                        {
                            if (!mutex.WaitOne(remaining)) return;
                        }
                        catch (AbandonedMutexException) { }
                        try { mutex.ReleaseMutex(); } catch { }
                    }
                }
                catch (WaitHandleCannotBeOpenedException) { }
                if (!File.Exists(exitMarker)) return;
                Thread.Sleep(100);
            }
        }

        private static void StopExactProcesses(string processName, string expectedPath)
        {
            int currentProcessId;
            using (Process current = Process.GetCurrentProcess()) currentProcessId = current.Id;
            foreach (Process process in Process.GetProcessesByName(processName))
            {
                try
                {
                    if (process.Id == currentProcessId) continue;
                    if (!IsInstalledAgentProcessPath(process.MainModule.FileName, expectedPath)) continue;
                    process.Kill();
                    process.WaitForExit(3000);
                }
                catch { }
                finally { process.Dispose(); }
            }
        }

        private static List<int> CaptureExactProcessIds(string processName, string expectedPath)
        {
            var result = new List<int>();
            int currentProcessId;
            using (Process current = Process.GetCurrentProcess()) currentProcessId = current.Id;
            foreach (Process process in Process.GetProcessesByName(processName))
            {
                try
                {
                    if (process.Id != currentProcessId && !process.HasExited && IsInstalledAgentProcessPath(process.MainModule.FileName, expectedPath)) result.Add(process.Id);
                }
                catch { }
                finally { process.Dispose(); }
            }
            return result;
        }

        private static void StopCapturedProcesses(IEnumerable<int> processIds, string expectedPath)
        {
            foreach (int processId in processIds)
            {
                try
                {
                    using (Process process = Process.GetProcessById(processId))
                    {
                        if (process.HasExited || !IsInstalledAgentProcessPath(process.MainModule.FileName, expectedPath)) continue;
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch { }
            }
        }

        private static void ShowNativeNotification(string encodedPayload)
        {
            string title = "NAS Drive";
            string message = "NAS Drive 요청을 처리하지 못했습니다.";
            MessageBoxIcon icon = MessageBoxIcon.Information;
            try
            {
                string json = Encoding.UTF8.GetString(Convert.FromBase64String(encodedPayload));
                var payload = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                if (payload != null)
                {
                    object rawTitle;
                    object rawMessage;
                    if (payload.TryGetValue("title", out rawTitle)) title = Convert.ToString(rawTitle) ?? title;
                    if (payload.TryGetValue("message", out rawMessage)) message = Convert.ToString(rawMessage) ?? message;
                }
                if (title.IndexOf("오프라인", StringComparison.OrdinalIgnoreCase) >= 0 || title.IndexOf("로그인 필요", StringComparison.OrdinalIgnoreCase) >= 0) icon = MessageBoxIcon.Warning;
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var owner = new Form())
            {
                owner.Text = title;
                owner.TopMost = true;
                owner.ShowInTaskbar = false;
                owner.FormBorderStyle = FormBorderStyle.None;
                owner.StartPosition = FormStartPosition.CenterScreen;
                owner.Size = new Size(1, 1);
                owner.Opacity = 0;
                owner.Show();
                owner.Activate();
                MessageBox.Show(owner, message, title, MessageBoxButtons.OK, icon);
            }
        }

        internal static void StartInstalledAgent(string installedExe, string arguments)
        {
            Process.Start(new ProcessStartInfo(installedExe, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(installedExe)
            });
        }

        internal static void OpenWebWithBrowserPicker(string installedExe)
        {
            bool created;
            using (var pickerMutex = new Mutex(true, "Local\\NAS-Drive-Web-Browser-Picker-SingleInstance", out created))
            {
                if (!created)
                {
                    FocusExistingLauncherWindow("NAS 웹에서 열기");
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                BrowserSelection selection;
                using (var picker = new WebBrowserPickerForm())
                {
                    if (picker.ShowDialog() != DialogResult.OK || picker.Selection == null) return;
                    selection = picker.Selection;
                }
                string arguments = "--open-web --hidden-bootstrap --web-browser " + QuoteArgument(selection.BrowserId);
                if (!string.IsNullOrWhiteSpace(selection.ProfileDirectory))
                    arguments += " --web-browser-profile " + QuoteArgument(selection.ProfileDirectory);
                StartInstalledAgent(installedExe, arguments);
            }
        }

        private static void StartBackgroundLauncher()
        {
            string launcher = Application.ExecutablePath;
            Process.Start(new ProcessStartInfo(launcher, "--background")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(launcher)
            });
        }

        internal static string QuoteArgument(string value)
        {
            var result = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char ch in value ?? "")
            {
                if (ch == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (ch == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0) result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(ch);
            }
            if (backslashes > 0) result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        internal static string JsonEscape(string value)
        {
            var builder = new StringBuilder();
            foreach (char ch in value ?? "")
            {
                switch (ch)
                {
                    case '\\': builder.Append("\\\\"); break;
                    case '"': builder.Append("\\\""); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (ch < 32) builder.Append("\\u" + ((int)ch).ToString("x4"));
                        else builder.Append(ch);
                        break;
                }
            }
            return builder.ToString();
        }

        private static bool RunSelfTest()
        {
            try
            {
                Version version;
                if (!Version.TryParse(ProductVersion, out version)) return false;
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("NasDrive.Agent"))
                {
                    if (stream == null || stream.Length < 1024 * 1024) return false;
                }
                return ResolveInstallState(false, "", "", "package") == InstallState.FirstInstall
                    && ResolveInstallState(true, ProductVersion, "same", "same") == InstallState.SameVersion
                    && ResolveInstallState(true, "1.6.0", "old", "new") == InstallState.Upgrade
                    && ResolveInstallState(true, ProductVersion, "changed", "new") == InstallState.Repair
                    && ResolveInstallState(true, "1.9.0", "newer", "new") == InstallState.NewerInstalled
                    && IsKnownInstallerFileName("NAS-Drive-Setup_pair_test (2).exe")
                    && IsKnownInstallerFileName("NAS-Sync-Agent_pair_test.exe")
                    && !IsKnownInstallerFileName("my-important-file.exe")
                    && IsInstalledLauncherProcessPath(@"C:\Apps\NAS-Drive.exe", @"C:\Apps\NAS-Drive.exe")
                    && IsInstalledLauncherProcessPath(@"C:\Apps\NAS-Drive.exe.previous", @"C:\Apps\NAS-Drive.exe")
                    && !IsInstalledLauncherProcessPath(@"C:\Other\NAS-Drive.exe", @"C:\Apps\NAS-Drive.exe")
                    && IsInstalledAgentProcessPath(@"C:\Apps\NAS-Sync-Agent.exe", @"C:\Apps\NAS-Sync-Agent.exe")
                    && !IsInstalledAgentProcessPath(@"C:\Old\NAS-Sync-Agent.exe", @"C:\Apps\NAS-Sync-Agent.exe")
                    && QuoteArgument(@"C:\Users\Me\NAS Drive") == "\"C:\\Users\\Me\\NAS Drive\""
                    && QuoteArgument("C:\\Path\\") == "\"C:\\Path\\\\\""
                    && NativeControlCenter.ShouldTreatHealthAsOffline("up-to-date", 13, true)
                    && !NativeControlCenter.ShouldTreatHealthAsOffline("needs-relink", 300, true)
                    && !NativeControlCenter.ShouldTreatHealthAsOffline("error", 300, true)
                    && !NativeControlCenter.ShouldTreatHealthAsOffline("paused", 300, true);
            }
            catch { return false; }
        }

        internal static InstallState ResolveInstallState(bool installedExists, string installedVersion, string installedHash, string packageHash)
        {
            if (!installedExists) return InstallState.FirstInstall;
            if (!string.IsNullOrWhiteSpace(installedHash)
                && string.Equals(installedHash, packageHash, StringComparison.OrdinalIgnoreCase)) return InstallState.SameVersion;
            Version installed;
            Version current;
            if (Version.TryParse(installedVersion, out installed) && Version.TryParse(ProductVersion, out current))
            {
                if (installed.CompareTo(current) > 0) return InstallState.NewerInstalled;
                if (installed.CompareTo(current) < 0) return InstallState.Upgrade;
                return InstallState.Repair;
            }
            return InstallState.Upgrade;
        }
    }

    internal sealed class BrowserSelection
    {
        internal string BrowserId = "system";
        internal string ProfileDirectory = "";
    }

    internal sealed class BrowserProfileChoice
    {
        internal string DirectoryName = "";
        internal string Label = "";
        internal string Account = "";
        internal string AvatarPath = "";
        internal bool IsLastUsed;

        public override string ToString()
        {
            string text = Label;
            if (!string.IsNullOrWhiteSpace(Account)) text += "  ·  " + Account;
            if (IsLastUsed) text += "  (최근 사용)";
            return text;
        }
    }

    internal sealed class BrowserChoice
    {
        internal string Id = "system";
        internal string Label = "Windows 기본 브라우저";
        internal string ExecutablePath = "";
        internal readonly List<BrowserProfileChoice> Profiles = new List<BrowserProfileChoice>();
        public override string ToString() { return Label; }
    }

    internal sealed class WebBrowserPickerForm : Form
    {
        private static readonly Color BrandBlue = Color.FromArgb(26, 86, 219);
        private static readonly Color CardBorder = Color.FromArgb(222, 228, 238);
        private static readonly Color CardHover = Color.FromArgb(242, 247, 255);
        private readonly Label title = new Label();
        private readonly Label subtitle = new Label();
        private readonly FlowLayoutPanel cards = new FlowLayoutPanel();
        private readonly Button backButton = new Button();
        private readonly Label privacyHint = new Label();
        private List<BrowserChoice> browserChoices = new List<BrowserChoice>();
        private BrowserChoice selectedBrowser;
        internal BrowserSelection Selection { get; private set; }

        internal WebBrowserPickerForm()
        {
            BuildUi();
            LoadChoices();
        }

        private void BuildUi()
        {
            AutoScaleMode = AutoScaleMode.None;
            Text = "NAS 웹에서 열기";
            ClientSize = new Size(720, 570);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            BackColor = Color.White;

            title.Location = new Point(34, 25);
            title.Size = new Size(650, 40);
            title.Font = Program.UiFont("Segoe UI Semibold", 17f);
            Controls.Add(title);
            subtitle.Location = new Point(36, 70);
            subtitle.Size = new Size(640, 50);
            subtitle.ForeColor = Color.FromArgb(86, 93, 108);
            subtitle.Font = Program.UiFont("Segoe UI", 10f);
            Controls.Add(subtitle);

            cards.Location = new Point(30, 130);
            cards.Size = new Size(660, 340);
            cards.AutoScroll = true;
            cards.WrapContents = true;
            cards.FlowDirection = FlowDirection.LeftToRight;
            cards.Padding = new Padding(5);
            cards.BackColor = Color.White;
            Controls.Add(cards);

            backButton.Text = "← 브라우저 다시 선택";
            backButton.Location = new Point(34, 493);
            backButton.Size = new Size(168, 38);
            backButton.FlatStyle = FlatStyle.Flat;
            backButton.FlatAppearance.BorderColor = CardBorder;
            backButton.BackColor = Color.White;
            backButton.Font = Program.UiFont("Segoe UI", 9.5f);
            backButton.Click += (sender, args) => ShowBrowserPage();
            Controls.Add(backButton);

            privacyHint.Location = new Point(218, 490);
            privacyHint.Size = new Size(468, 50);
            privacyHint.TextAlign = ContentAlignment.MiddleRight;
            privacyHint.ForeColor = Color.DimGray;
            privacyHint.Font = Program.UiFont("Segoe UI", 8.8f);
            Controls.Add(privacyHint);

            var cancel = new Button { Text = "취소", Location = new Point(594, 535), Size = new Size(96, 30), DialogResult = DialogResult.Cancel, FlatStyle = FlatStyle.Flat, Font = Program.UiFont("Segoe UI", 9f) };
            cancel.FlatAppearance.BorderColor = CardBorder;
            Controls.Add(cancel);
            CancelButton = cancel;
        }

        private void LoadChoices()
        {
            browserChoices = DiscoverBrowsers();
            ShowBrowserPage();
        }

        private void ShowBrowserPage()
        {
            selectedBrowser = null;
            title.Text = "어떤 브라우저로 열까요?";
            subtitle.Text = "먼저 브라우저를 선택하세요. 다음 화면에서 해당 브라우저의 사용자를 고를 수 있습니다.";
            backButton.Visible = false;
            privacyHint.Text = "브라우저를 선택하기 전에는 로그인 주소를 만들지 않습니다.";
            cards.SuspendLayout();
            cards.Controls.Clear();
            foreach (BrowserChoice choice in browserChoices)
            {
                BrowserChoice captured = choice;
                cards.Controls.Add(CreateBrowserCard(choice, (sender, args) => SelectBrowser(captured)));
            }
            cards.ResumeLayout();
        }

        private void SelectBrowser(BrowserChoice browser)
        {
            if (browser == null) return;
            if (browser.Id == "system")
            {
                Selection = new BrowserSelection { BrowserId = "system", ProfileDirectory = "" };
                DialogResult = DialogResult.OK;
                Close();
                return;
            }
            selectedBrowser = browser;
            ShowProfilePage();
        }

        private void ShowProfilePage()
        {
            if (selectedBrowser == null) { ShowBrowserPage(); return; }
            title.Text = selectedBrowser.Label + " 사용자 선택";
            subtitle.Text = "웹 NAS를 열 프로필을 선택하세요. 선택한 브라우저 창에서 현재 NAS Drive 계정으로 자동 로그인합니다.";
            backButton.Visible = true;
            privacyHint.Text = "표시 이름·대표 이메일·로컬 프로필 이미지만 사용하며 쿠키와 비밀번호는 읽지 않습니다.";
            cards.SuspendLayout();
            cards.Controls.Clear();
            if (selectedBrowser.Profiles.Count == 0)
            {
                selectedBrowser.Profiles.Add(new BrowserProfileChoice { Label = "기본 사용자", DirectoryName = "" });
            }
            foreach (BrowserProfileChoice profile in selectedBrowser.Profiles)
            {
                BrowserProfileChoice captured = profile;
                cards.Controls.Add(CreateProfileCard(profile, (sender, args) => CompleteSelection(captured)));
            }
            cards.ResumeLayout();
        }

        private void CompleteSelection(BrowserProfileChoice profile)
        {
            if (selectedBrowser == null || profile == null) return;
            Selection = new BrowserSelection { BrowserId = selectedBrowser.Id, ProfileDirectory = profile.DirectoryName };
            DialogResult = DialogResult.OK;
            Close();
        }

        private Control CreateBrowserCard(BrowserChoice browser, EventHandler click)
        {
            var card = CreateCard(new Size(200, 185), click);
            var logo = new PictureBox { Location = new Point(65, 24), Size = new Size(70, 70), SizeMode = PictureBoxSizeMode.Zoom, Image = LoadBrowserLogo(browser) };
            var name = new Label { Text = browser.Label, Location = new Point(10, 108), Size = new Size(180, 30), TextAlign = ContentAlignment.MiddleCenter, Font = Program.UiFont("Segoe UI Semibold", 10.5f) };
            var action = new Label { Text = browser.Id == "system" ? "바로 열기" : "사용자 선택", Location = new Point(10, 143), Size = new Size(180, 24), TextAlign = ContentAlignment.MiddleCenter, ForeColor = BrandBlue, Font = Program.UiFont("Segoe UI", 9f) };
            card.Controls.AddRange(new Control[] { logo, name, action });
            WireCardClick(card, click);
            return card;
        }

        private Control CreateProfileCard(BrowserProfileChoice profile, EventHandler click)
        {
            var card = CreateCard(new Size(200, 215), click);
            var avatar = new PictureBox { Location = new Point(64, 18), Size = new Size(72, 72), SizeMode = PictureBoxSizeMode.Zoom, Image = LoadProfileAvatar(profile) };
            var name = new Label { Text = profile.Label, Location = new Point(10, 101), Size = new Size(180, 28), TextAlign = ContentAlignment.MiddleCenter, Font = Program.UiFont("Segoe UI Semibold", 10.5f), AutoEllipsis = true };
            var account = new Label { Text = string.IsNullOrWhiteSpace(profile.Account) ? "브라우저 사용자" : profile.Account, Location = new Point(10, 132), Size = new Size(180, 42), TextAlign = ContentAlignment.TopCenter, ForeColor = Color.DimGray, Font = Program.UiFont("Segoe UI", 8.5f), AutoEllipsis = true };
            var recent = new Label { Text = profile.IsLastUsed ? "최근 사용" : "선택", Location = new Point(58, 178), Size = new Size(84, 24), TextAlign = ContentAlignment.MiddleCenter, ForeColor = profile.IsLastUsed ? Color.White : BrandBlue, BackColor = profile.IsLastUsed ? BrandBlue : Color.White, Font = Program.UiFont("Segoe UI Semibold", 8.5f) };
            card.Controls.AddRange(new Control[] { avatar, name, account, recent });
            WireCardClick(card, click);
            return card;
        }

        private Panel CreateCard(Size size, EventHandler click)
        {
            var card = new Panel { Size = size, Margin = new Padding(7), BackColor = Color.White, Cursor = Cursors.Hand };
            card.Paint += (sender, args) => ControlPaint.DrawBorder(args.Graphics, card.ClientRectangle, CardBorder, ButtonBorderStyle.Solid);
            card.MouseEnter += (sender, args) => card.BackColor = CardHover;
            card.MouseLeave += (sender, args) => card.BackColor = Color.White;
            return card;
        }

        private static void WireCardClick(Control control, EventHandler click)
        {
            control.Cursor = Cursors.Hand;
            control.Click += click;
            foreach (Control child in control.Controls) WireCardClick(child, click);
        }

        private static Image LoadBrowserLogo(BrowserChoice browser)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(browser.ExecutablePath))
                {
                    using (Icon icon = Icon.ExtractAssociatedIcon(browser.ExecutablePath))
                    {
                        if (icon != null) return icon.ToBitmap();
                    }
                }
            }
            catch { }
            return CreateWindowsLogo();
        }

        private static Image LoadProfileAvatar(BrowserProfileChoice profile)
        {
            try
            {
                var info = new FileInfo(profile.AvatarPath ?? "");
                if (info.Exists && info.Length > 0 && info.Length <= 4 * 1024 * 1024)
                {
                    using (var stream = new FileStream(info.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var original = Image.FromStream(stream)) return new Bitmap(original);
                }
            }
            catch { }
            return CreateInitialAvatar(profile.Label);
        }

        private static Image CreateInitialAvatar(string label)
        {
            var bitmap = new Bitmap(96, 96);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (Brush brush = new SolidBrush(BrandBlue))
            {
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.FillEllipse(brush, 1, 1, 94, 94);
                string initial = string.IsNullOrWhiteSpace(label) ? "?" : label.Trim().Substring(0, 1).ToUpperInvariant();
                TextRenderer.DrawText(graphics, initial, Program.UiFont("Segoe UI Semibold", 27f), new Rectangle(0, 0, 96, 96), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            return bitmap;
        }

        private static Image CreateWindowsLogo()
        {
            var bitmap = new Bitmap(96, 96);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (Brush brush = new SolidBrush(BrandBlue))
            {
                graphics.FillRectangle(brush, 10, 11, 35, 35);
                graphics.FillRectangle(brush, 51, 11, 35, 35);
                graphics.FillRectangle(brush, 10, 52, 35, 35);
                graphics.FillRectangle(brush, 51, 52, 35, 35);
            }
            return bitmap;
        }

        private static List<BrowserChoice> DiscoverBrowsers()
        {
            var result = new List<BrowserChoice>();
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            AddChromiumBrowser(result, "chrome", "Google Chrome", new[]
            {
                Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe")
            }, Path.Combine(localAppData, "Google", "Chrome", "User Data"));
            AddChromiumBrowser(result, "edge", "Microsoft Edge", new[]
            {
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
            }, Path.Combine(localAppData, "Microsoft", "Edge", "User Data"));
            result.Add(new BrowserChoice { Id = "system", Label = "Windows 기본 브라우저" });
            return result;
        }

        private static void AddChromiumBrowser(List<BrowserChoice> choices, string id, string label, IEnumerable<string> executables, string userDataRoot)
        {
            bool installed = false;
            foreach (string executable in executables)
            {
                if (File.Exists(executable)) { installed = true; break; }
            }
            if (!installed) return;
            string executablePath = "";
            foreach (string executable in executables) if (File.Exists(executable)) { executablePath = executable; break; }
            var choice = new BrowserChoice { Id = id, Label = label, ExecutablePath = executablePath };
            foreach (BrowserProfileChoice profile in ReadProfiles(userDataRoot)) choice.Profiles.Add(profile);
            choices.Add(choice);
        }

        private static List<BrowserProfileChoice> ReadProfiles(string userDataRoot)
        {
            var profiles = new List<BrowserProfileChoice>();
            try
            {
                string localStatePath = Path.Combine(userDataRoot, "Local State");
                var info = new FileInfo(localStatePath);
                if (!info.Exists || info.Length > 8 * 1024 * 1024) return profiles;
                string json;
                using (var stream = new FileStream(localStatePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream, Encoding.UTF8, true)) json = reader.ReadToEnd();
                if (Encoding.UTF8.GetByteCount(json) > 8 * 1024 * 1024) return profiles;
                var root = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 }.DeserializeObject(json) as Dictionary<string, object>;
                Dictionary<string, object> profileState = GetDictionary(root, "profile");
                Dictionary<string, object> infoCache = GetDictionary(profileState, "info_cache");
                if (infoCache == null) return profiles;
                string lastUsed = SafeProfileDirectory(GetString(profileState, "last_used"));
                var order = new List<string>();
                AppendProfileOrder(order, profileState, "profiles_order");
                AppendProfileOrder(order, profileState, "last_active_profiles");
                AppendUnique(order, lastUsed);
                foreach (string key in infoCache.Keys) AppendUnique(order, SafeProfileDirectory(key));
                foreach (string directoryName in order)
                {
                    if (string.IsNullOrWhiteSpace(directoryName) || !Directory.Exists(Path.Combine(userDataRoot, directoryName))) continue;
                    object rawInfo;
                    if (!infoCache.TryGetValue(directoryName, out rawInfo)) continue;
                    var profileInfo = rawInfo as Dictionary<string, object>;
                    if (profileInfo == null || GetBool(profileInfo, "is_omitted_from_profile_list")) continue;
                    string displayName = CleanPublicText(GetString(profileInfo, "name"), 80);
                    if (string.IsNullOrWhiteSpace(displayName)) displayName = CleanPublicText(GetString(profileInfo, "shortcut_name"), 80);
                    if (string.IsNullOrWhiteSpace(displayName)) displayName = labelForProfile(directoryName);
                    profiles.Add(new BrowserProfileChoice
                    {
                        DirectoryName = directoryName,
                        Label = displayName,
                        Account = CleanPublicText(GetString(profileInfo, "user_name"), 320),
                        AvatarPath = GetSafeAvatarPath(userDataRoot, directoryName),
                        IsLastUsed = string.Equals(directoryName, lastUsed, StringComparison.Ordinal)
                    });
                }
            }
            catch { }
            return profiles;
        }

        private static string GetSafeAvatarPath(string userDataRoot, string directoryName)
        {
            try
            {
                string profileRoot = Path.GetFullPath(Path.Combine(userDataRoot, directoryName));
                string expectedRoot = Path.GetFullPath(userDataRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!profileRoot.StartsWith(expectedRoot, StringComparison.OrdinalIgnoreCase)) return "";
                string avatar = Path.Combine(profileRoot, "Google Profile Picture.png");
                var info = new FileInfo(avatar);
                return info.Exists && info.Length > 0 && info.Length <= 4 * 1024 * 1024 ? info.FullName : "";
            }
            catch { return ""; }
        }

        private static string labelForProfile(string directoryName)
        {
            return directoryName == "Default" ? "기본 사용자" : "브라우저 사용자";
        }

        private static Dictionary<string, object> GetDictionary(Dictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
        }

        private static string GetString(Dictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) ? Convert.ToString(value) ?? "" : "";
        }

        private static bool GetBool(Dictionary<string, object> source, string key)
        {
            object value;
            if (source == null || !source.TryGetValue(key, out value) || value == null) return false;
            bool result;
            return bool.TryParse(Convert.ToString(value), out result) && result;
        }

        private static void AppendProfileOrder(List<string> order, Dictionary<string, object> profileState, string key)
        {
            object raw;
            if (profileState == null || !profileState.TryGetValue(key, out raw)) return;
            object[] values = raw as object[];
            if (values == null) return;
            foreach (object value in values) AppendUnique(order, SafeProfileDirectory(Convert.ToString(value)));
        }

        private static void AppendUnique(List<string> order, string value)
        {
            if (!string.IsNullOrWhiteSpace(value) && !order.Contains(value)) order.Add(value);
        }

        private static string SafeProfileDirectory(string value)
        {
            string text = (value ?? "").Trim();
            return Regex.IsMatch(text, @"^(Default|Profile [1-9][0-9]{0,5})$") ? text : "";
        }

        private static string CleanPublicText(string value, int maxLength)
        {
            string text = Regex.Replace(value ?? "", @"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]", " ");
            text = Regex.Replace(text, @"\s+", " ").Trim();
            return text.Length <= maxLength ? text : text.Substring(0, maxLength);
        }
    }

    internal sealed class NativeLoginForm : Form
    {
        private static readonly Color BrandBlue = Color.FromArgb(26, 86, 219);
        private readonly string agentExe;
        private readonly TextBox loginId = new TextBox();
        private readonly TextBox password = new TextBox();
        private readonly TextBox drivePath = new TextBox();
        private readonly Label status = new Label();
        private readonly Button loginButton = new Button();
        private readonly Button signupButton = new Button();
        private bool customDrivePath;

        internal NativeLoginForm(string installedAgentExe)
        {
            agentExe = installedAgentExe;
            BuildUi();
        }

        private void BuildUi()
        {
            AutoScaleMode = AutoScaleMode.None;
            Text = "NAS Drive 로그인";
            ClientSize = new Size(470, 650);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            BackColor = Color.White;

            var header = new Panel { Location = new Point(0, 0), Size = new Size(470, 128), BackColor = BrandBlue };
            header.Controls.Add(new Label { Text = "NAS DRIVE", Location = new Point(34, 24), Size = new Size(390, 24), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 11f) });
            header.Controls.Add(new Label { Text = "내 파일을 Windows와 연결", Location = new Point(32, 58), Size = new Size(400, 43), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 19f) });

            Controls.Add(header);
            Controls.Add(new Label { Text = "NAS 계정으로 로그인", Location = new Point(36, 158), Size = new Size(395, 35), Font = Program.UiFont("Segoe UI Semibold", 17f) });
            Controls.Add(new Label { Text = "로그인하면 파일 탐색기에 계정 전용 NAS Drive가 연결됩니다.", Location = new Point(38, 201), Size = new Size(395, 42), ForeColor = Color.FromArgb(75, 82, 96), Font = Program.UiFont("Segoe UI", 9.5f) });
            Controls.Add(new Label { Text = "아이디", Location = new Point(38, 252), Size = new Size(390, 24), Font = Program.UiFont("Segoe UI Semibold", 9.5f) });
            loginId.Location = new Point(38, 279);
            loginId.Size = new Size(394, 30);
            loginId.Font = Program.UiFont("Segoe UI", 11f);
            Controls.Add(loginId);

            Controls.Add(new Label { Text = "비밀번호", Location = new Point(38, 326), Size = new Size(390, 24), Font = Program.UiFont("Segoe UI Semibold", 9.5f) });
            password.Location = new Point(38, 353);
            password.Size = new Size(394, 30);
            password.Font = Program.UiFont("Segoe UI", 11f);
            password.UseSystemPasswordChar = true;
            password.KeyDown += async (sender, args) => { if (args.KeyCode == Keys.Enter) await LoginAsync(); };
            Controls.Add(password);

            Controls.Add(new Label { Text = "NAS Drive 위치", Location = new Point(38, 398), Size = new Size(390, 24), Font = Program.UiFont("Segoe UI Semibold", 9.5f) });
            drivePath.Location = new Point(38, 425);
            drivePath.Size = new Size(294, 30);
            drivePath.Font = Program.UiFont("Segoe UI", 9.5f);
            drivePath.ReadOnly = true;
            drivePath.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "NAS Drive - 계정명");
            Controls.Add(drivePath);
            var browse = new Button { Text = "위치 변경", Location = new Point(342, 423), Size = new Size(90, 34) };
            browse.Click += (sender, args) =>
            {
                using (var dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "NAS Drive를 저장할 위치를 선택하세요.";
                    dialog.SelectedPath = customDrivePath && Directory.Exists(drivePath.Text) ? drivePath.Text : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    if (dialog.ShowDialog(this) == DialogResult.OK)
                    {
                        drivePath.Text = dialog.SelectedPath;
                        customDrivePath = true;
                    }
                }
            };
            Controls.Add(browse);
            var resetLocation = new LinkLabel { Text = "계정 이름을 사용하는 권장 기본 위치로 되돌리기", Location = new Point(38, 465), Size = new Size(394, 24), LinkColor = BrandBlue };
            resetLocation.Click += (sender, args) =>
            {
                customDrivePath = false;
                drivePath.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "NAS Drive - 계정명");
            };
            Controls.Add(resetLocation);

            status.Location = new Point(38, 505);
            status.Size = new Size(394, 42);
            status.ForeColor = BrandBlue;
            status.Font = Program.UiFont("Segoe UI Semibold", 9f);
            Controls.Add(status);

            signupButton.Text = "회원가입";
            signupButton.Location = new Point(38, 570);
            signupButton.Size = new Size(124, 40);
            signupButton.Click += (sender, args) => Process.Start(new ProcessStartInfo("https://filemanager-nas.com/signup?next=%2Fplatform%3FpcConnect%3D1") { UseShellExecute = true });
            Controls.Add(signupButton);

            loginButton.Text = "로그인";
            loginButton.Location = new Point(238, 570);
            loginButton.Size = new Size(194, 40);
            loginButton.BackColor = BrandBlue;
            loginButton.ForeColor = Color.White;
            loginButton.FlatStyle = FlatStyle.Flat;
            loginButton.Font = Program.UiFont("Segoe UI Semibold", 10f);
            loginButton.Click += async (sender, args) => await LoginAsync();
            Controls.Add(loginButton);

            AcceptButton = loginButton;
            Shown += (sender, args) => loginId.Focus();
        }

        private async Task LoginAsync()
        {
            string id = loginId.Text.Trim();
            string secret = password.Text;
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrEmpty(secret))
            {
                status.ForeColor = Color.Firebrick;
                status.Text = "아이디와 비밀번호를 모두 입력해 주세요.";
                return;
            }

            loginButton.Enabled = false;
            signupButton.Enabled = false;
            loginId.Enabled = false;
            password.Enabled = false;
            status.ForeColor = BrandBlue;
            status.Text = "계정을 확인하고 NAS Drive를 연결하는 중입니다...";
            try
            {
                string selectedDrivePath = customDrivePath ? drivePath.Text.Trim() : "";
                await Task.Run(() => AuthenticateAndConfigure(id, secret, selectedDrivePath));
                password.Clear();
                status.Text = "연결이 완료되었습니다. 계정 상태를 여는 중입니다...";
                string launcher = Application.ExecutablePath;
                Process.Start(new ProcessStartInfo(launcher, "--background") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
                Hide();
                using (var center = new NativeControlCenter(agentExe)) center.ShowDialog(this);
                Close();
            }
            catch (Exception error)
            {
                status.ForeColor = Color.Firebrick;
                status.Text = FriendlyError(error.Message);
                password.SelectAll();
                password.Focus();
            }
            finally
            {
                loginButton.Enabled = true;
                signupButton.Enabled = true;
                loginId.Enabled = true;
                password.Enabled = true;
            }
        }

        private void AuthenticateAndConfigure(string id, string secret, string selectedDrivePath)
        {
            var login = new ProcessStartInfo(agentExe, "--login-stdin")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(agentExe)
            };
            string pairingToken;
            string loginError;
            using (var process = Process.Start(login))
            {
                process.StandardInput.Write("{\"id\":\"" + Program.JsonEscape(id) + "\",\"password\":\"" + Program.JsonEscape(secret) + "\"}");
                process.StandardInput.Close();
                pairingToken = process.StandardOutput.ReadToEnd().Trim();
                loginError = process.StandardError.ReadToEnd().Trim();
                if (!process.WaitForExit(30000))
                {
                    try { process.Kill(); } catch { }
                    throw new InvalidOperationException("NAS 로그인 응답 시간이 초과되었습니다.");
                }
                if (process.ExitCode != 0 || string.IsNullOrWhiteSpace(pairingToken)) throw new InvalidOperationException(loginError.Length > 0 ? loginError : "로그인 정보를 확인할 수 없습니다.");
            }

            string setupArguments = "--pairing-token " + Program.QuoteArgument(pairingToken) + " --auto-setup --hidden-bootstrap";
            if (!string.IsNullOrWhiteSpace(selectedDrivePath)) setupArguments += " --drive-path " + Program.QuoteArgument(selectedDrivePath);
            var setup = Process.Start(new ProcessStartInfo(agentExe, setupArguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(agentExe)
            });
            if (!setup.WaitForExit(180000))
            {
                try { setup.Kill(); } catch { }
                throw new InvalidOperationException("NAS Drive 초기 구성이 예상보다 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
            }
            if (setup.ExitCode != 0 || !NativeControlCenter.HasConfiguredProfile()) throw new InvalidOperationException("NAS Drive 연결을 완료하지 못했습니다. NAS 서버 연결을 확인해 주세요.");
        }

        private static string FriendlyError(string message)
        {
            string text = message ?? "로그인하지 못했습니다.";
            if (text.Contains("401") || text.Contains("403")) return "아이디 또는 비밀번호를 확인해 주세요.";
            if (text.Contains("503") || text.IndexOf("연결", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0) return "NAS 서버에 연결할 수 없습니다. 서버 전원과 인터넷 연결을 확인해 주세요.";
            return text.Length > 180 ? text.Substring(0, 180) : text;
        }
    }

    internal sealed class AccountSnapshot
    {
        internal string AccountKey = "";
        internal string LoginId = "";
        internal string DisplayName = "";
        internal string DeviceId = "";
        internal string DrivePath = "";
        internal int AccountCount;
    }

    internal sealed class NativeControlCenter : Form
    {
        private static readonly Color BrandBlue = Color.FromArgb(26, 86, 219);
        private static readonly string StateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent");
        private static readonly string ConfigFile = Path.Combine(StateDir, "agent-config.json");
        private static readonly string HealthFile = Path.Combine(StateDir, "agent-health.json");
        private readonly string agentExe;
        private readonly Label accountLabel = new Label();
        private readonly Label statusLabel = new Label();
        private readonly Label driveLabel = new Label();
        private readonly Button logoutButton = new Button();
        private readonly System.Windows.Forms.Timer refreshTimer = new System.Windows.Forms.Timer();

        internal NativeControlCenter(string installedAgentExe)
        {
            agentExe = installedAgentExe;
            BuildUi();
            RefreshStatus();
            refreshTimer.Interval = 3000;
            refreshTimer.Tick += (sender, args) => RefreshStatus();
            refreshTimer.Start();
            FormClosed += (sender, args) => refreshTimer.Stop();
        }

        internal static bool HasUsableProfile()
        {
            try
            {
                string health = File.Exists(HealthFile) ? File.ReadAllText(HealthFile, Encoding.UTF8) : "";
                if (Regex.IsMatch(health, "\\\"state\\\"\\s*:\\s*\\\"needs-relink\\\"")
                    || Regex.IsMatch(health, "\\\"needsRelink\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) return false;
                return HasConfiguredProfile();
            }
            catch { return false; }
        }

        internal static bool HasConfiguredProfile()
        {
            AccountSnapshot account = ActiveAccount();
            return account != null && !string.IsNullOrWhiteSpace(account.AccountKey) && !string.IsNullOrWhiteSpace(account.DeviceId);
        }

        internal static string FirstDrivePath()
        {
            AccountSnapshot account = ActiveAccount();
            return account == null ? "" : account.DrivePath;
        }

        internal static AccountSnapshot ActiveAccount()
        {
            try
            {
                var serializer = new JavaScriptSerializer();
                var config = serializer.DeserializeObject(File.ReadAllText(ConfigFile, Encoding.UTF8)) as Dictionary<string, object>;
                if (config == null) return null;
                string activeKey = GetString(config, "activeAccountKey");
                object rawProfiles;
                var profiles = config.TryGetValue("profiles", out rawProfiles) ? rawProfiles as object[] : null;
                if (profiles == null || profiles.Length == 0) return null;
                Dictionary<string, object> selected = null;
                foreach (object item in profiles)
                {
                    var profile = item as Dictionary<string, object>;
                    if (profile == null) continue;
                    if (selected == null) selected = profile;
                    if (!string.IsNullOrWhiteSpace(activeKey) && string.Equals(GetString(profile, "accountKey"), activeKey, StringComparison.OrdinalIgnoreCase))
                    {
                        selected = profile;
                        break;
                    }
                }
                if (selected == null) return null;
                string drivePath = "";
                object rawRoots;
                var roots = selected.TryGetValue("syncRoots", out rawRoots) ? rawRoots as object[] : null;
                if (roots != null)
                {
                    foreach (object item in roots)
                    {
                        var root = item as Dictionary<string, object>;
                        if (root == null) continue;
                        string candidate = GetString(root, "localPath");
                        if (string.IsNullOrWhiteSpace(drivePath)) drivePath = candidate;
                        if (string.Equals(GetString(root, "kind"), "personal-drive", StringComparison.OrdinalIgnoreCase))
                        {
                            drivePath = candidate;
                            break;
                        }
                    }
                }
                return new AccountSnapshot
                {
                    AccountKey = GetString(selected, "accountKey"),
                    LoginId = GetString(selected, "loginId"),
                    DisplayName = GetString(selected, "displayName"),
                    DeviceId = GetString(selected, "deviceId"),
                    DrivePath = drivePath,
                    AccountCount = profiles.Length
                };
            }
            catch { return null; }
        }

        private static string GetString(Dictionary<string, object> value, string name)
        {
            object result;
            return value != null && value.TryGetValue(name, out result) && result != null ? Convert.ToString(result) : "";
        }

        internal static string HealthState()
        {
            string state = ReadJsonValue(HealthFile, "state");
            string updatedAt = ReadJsonValue(HealthFile, "updatedAt");
            DateTime parsed;
            double ageSeconds = DateTime.TryParse(updatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out parsed)
                ? (DateTime.UtcNow - parsed.ToUniversalTime()).TotalSeconds
                : 0;
            if (ShouldTreatHealthAsOffline(state, ageSeconds, HasConfiguredProfile()))
            {
                return "offline";
            }
            return state;
        }

        internal static bool ShouldTreatHealthAsOffline(string state, double ageSeconds, bool hasConfiguredProfile)
        {
            if (!hasConfiguredProfile || ageSeconds <= 12) return false;
            return !string.Equals(state, "needs-relink", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(state, "error", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(state, "paused", StringComparison.OrdinalIgnoreCase);
        }

        internal static string HealthMessage()
        {
            return ReadJsonValue(HealthFile, "message");
        }

        private void BuildUi()
        {
            AutoScaleMode = AutoScaleMode.None;
            Text = "NAS Drive";
            ClientSize = new Size(620, 620);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.White;

            var header = new Panel { Location = new Point(0, 0), Size = new Size(620, 110), BackColor = BrandBlue };
            header.Controls.Add(new Label { Text = "NAS DRIVE", Location = new Point(32, 19), Size = new Size(540, 24), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 11f) });
            header.Controls.Add(new Label { Text = "내 NAS Drive", Location = new Point(30, 50), Size = new Size(540, 40), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 20f) });
            Controls.Add(header);

            accountLabel.Location = new Point(34, 135);
            accountLabel.Size = new Size(550, 58);
            accountLabel.Font = Program.UiFont("Segoe UI Semibold", 13f);
            Controls.Add(accountLabel);

            statusLabel.Location = new Point(34, 208);
            statusLabel.Size = new Size(550, 58);
            statusLabel.Font = Program.UiFont("Segoe UI Semibold", 11f);
            statusLabel.ForeColor = BrandBlue;
            Controls.Add(statusLabel);

            driveLabel.Location = new Point(34, 278);
            driveLabel.Size = new Size(550, 75);
            driveLabel.Font = Program.UiFont("Segoe UI", 9.5f);
            driveLabel.ForeColor = Color.FromArgb(75, 82, 96);
            Controls.Add(driveLabel);

            var stateGuide = new Panel { Location = new Point(34, 350), Size = new Size(550, 118), BackColor = Color.FromArgb(242, 247, 255) };
            stateGuide.Controls.Add(new Label { Text = "파일별 저장 상태", Location = new Point(16, 12), Size = new Size(500, 24), Font = Program.UiFont("Segoe UI Semibold", 10f), ForeColor = Color.FromArgb(32, 71, 126) });
            stateGuide.Controls.Add(new Label { Text = "☁  온라인 전용  ·  NAS에 저장되어 있으며 열 때 다운로드", Location = new Point(16, 39), Size = new Size(510, 22), Font = Program.UiFont("Segoe UI", 9f), ForeColor = Color.FromArgb(65, 76, 94) });
            stateGuide.Controls.Add(new Label { Text = "✓  이 PC에서 사용 가능  ·  이미 다운로드되어 오프라인 사용 가능", Location = new Point(16, 64), Size = new Size(510, 22), Font = Program.UiFont("Segoe UI", 9f), ForeColor = Color.FromArgb(65, 76, 94) });
            stateGuide.Controls.Add(new Label { Text = "●  항상 유지  ·  우클릭으로 고정, 공간 확보로 온라인 전용 전환", Location = new Point(16, 89), Size = new Size(510, 22), Font = Program.UiFont("Segoe UI", 9f), ForeColor = Color.FromArgb(65, 76, 94) });
            Controls.Add(stateGuide);

            var openDrive = new Button { Text = "NAS Drive 열기", Location = new Point(34, 492), Size = new Size(170, 44), BackColor = BrandBlue, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = Program.UiFont("Segoe UI Semibold", 9.5f) };
            openDrive.Click += (sender, args) => OpenDrive();
            Controls.Add(openDrive);

            var openWeb = new Button { Text = "웹에서 관리", Location = new Point(218, 492), Size = new Size(150, 44), Font = Program.UiFont("Segoe UI Semibold", 9.5f) };
            openWeb.Click += (sender, args) => Program.OpenWebWithBrowserPicker(agentExe);
            Controls.Add(openWeb);

            logoutButton.Text = "로그아웃";
            logoutButton.Location = new Point(382, 492);
            logoutButton.Size = new Size(202, 44);
            logoutButton.Font = Program.UiFont("Segoe UI Semibold", 9.5f);
            logoutButton.Click += async (sender, args) => await LogoutAsync();
            Controls.Add(logoutButton);

            Controls.Add(new Label { Text = "이 창을 닫아도 NAS Drive는 작업표시줄 알림 영역에서 계속 실행됩니다.", Location = new Point(34, 562), Size = new Size(410, 28), ForeColor = Color.DimGray, Font = Program.UiFont("Segoe UI", 9f) });
            var close = new Button { Text = "창 닫기", Location = new Point(464, 558), Size = new Size(120, 36), Font = Program.UiFont("Segoe UI Semibold", 9f) };
            close.Click += (sender, args) => Close();
            Controls.Add(close);
        }

        private void RefreshStatus()
        {
            AccountSnapshot account = ActiveAccount();
            string drive = account == null ? "" : account.DrivePath;
            string state = HealthState();
            string stateText = state == "offline" ? "NAS 서버 오프라인 - 서버가 켜지면 자동 재연결됩니다."
                : state == "syncing" ? "파일 동기화 중"
                : state == "needs-relink" ? "계정 다시 연결 필요"
                : state == "error" ? "동기화 오류"
                : state == "paused" ? "동기화 일시 중지"
                : state == "connecting" ? "NAS Drive 연결 중"
                : state == "updating" ? "NAS Drive 업데이트 중"
                : "NAS와 동기화됨";
            string displayName = account == null ? "연결된 계정 없음" : (!string.IsNullOrWhiteSpace(account.DisplayName) ? account.DisplayName : account.LoginId);
            string loginText = account == null || string.IsNullOrWhiteSpace(account.LoginId) ? "" : "  ·  " + account.LoginId;
            accountLabel.Text = displayName + loginText;
            statusLabel.Text = "● " + stateText;
            statusLabel.ForeColor = state == "offline" || state == "error" || state == "needs-relink" ? Color.FromArgb(190, 55, 55)
                : state == "syncing" || state == "connecting" || state == "updating" ? Color.FromArgb(218, 132, 21) : BrandBlue;
            driveLabel.Text = "저장 위치" + Environment.NewLine + (string.IsNullOrWhiteSpace(drive) ? "연결된 폴더 없음" : drive)
                + Environment.NewLine + "연결 계정 " + (account == null ? "0" : account.AccountCount.ToString()) + "개";
            logoutButton.Text = state == "needs-relink" || state == "connecting" ? "연결 해제 후 다시 로그인" : "로그아웃";
        }

        private static string ReadJsonValue(string file, string name)
        {
            try
            {
                Match match = Regex.Match(File.ReadAllText(file, Encoding.UTF8), "\\\"" + Regex.Escape(name) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
                return match.Success ? match.Groups[1].Value : "";
            }
            catch { return ""; }
        }

        private void OpenDrive()
        {
            string drive = FirstDrivePath();
            if (string.IsNullOrWhiteSpace(drive) || !Directory.Exists(drive))
            {
                MessageBox.Show("연결된 NAS Drive 폴더를 찾을 수 없습니다. 계정을 다시 연결해 주세요.", "NAS Drive", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Process.Start("explorer.exe", Program.QuoteArgument(drive));
        }

        private async Task LogoutAsync()
        {
            if (MessageBox.Show("현재 NAS 계정에서 로그아웃할까요?\n로컬 파일은 삭제하지 않습니다.", "NAS Drive 로그아웃", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            logoutButton.Enabled = false;
            statusLabel.Text = "NAS 계정 연결을 안전하게 해제하는 중입니다...";
            try
            {
                int exitCode = await Task.Run(() => RunLogout());
                if (exitCode != 0) throw new InvalidOperationException("로컬 연결을 해제하지 못했습니다. NAS Drive를 다시 열어 재시도해 주세요.");
                Hide();
                using (var login = new NativeLoginForm(agentExe)) login.ShowDialog(this);
                Close();
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "NAS Drive 로그아웃", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                logoutButton.Enabled = true;
                RefreshStatus();
            }
        }

        private int RunLogout()
        {
            using (var process = Process.Start(new ProcessStartInfo(agentExe, Program.QuoteArgument("nas-sync://logout?confirmed=1&native=1") + " --hidden-bootstrap")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(agentExe)
            }))
            {
                if (!process.WaitForExit(45000))
                {
                    try { process.Kill(); } catch { }
                    return 1;
                }
                return process.ExitCode;
            }
        }
    }

    internal sealed class NativeTrayContext : ApplicationContext
    {
        private static readonly string StateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent");
        private readonly string agentExe;
        private readonly string launcherExe;
        private readonly NotifyIcon notifyIcon = new NotifyIcon();
        private readonly ToolStripMenuItem accountItem = new ToolStripMenuItem();
        private readonly ToolStripMenuItem statusItem = new ToolStripMenuItem();
        private readonly ToolStripMenuItem openDriveItem = new ToolStripMenuItem("NAS Drive 열기");
        private readonly ToolStripMenuItem accountActionItem = new ToolStripMenuItem();
        private readonly System.Windows.Forms.Timer refreshTimer = new System.Windows.Forms.Timer();
        private Icon currentIcon;
        private string currentVisualState = "";
        private DateTime lastAgentStartAt = DateTime.MinValue;

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        internal NativeTrayContext(string installedAgentExe)
        {
            agentExe = installedAgentExe;
            launcherExe = Application.ExecutablePath;
            StopLegacyTray();

            accountItem.Enabled = false;
            accountItem.Font = Program.UiFont("Segoe UI Semibold", 9f);
            statusItem.Enabled = false;
            openDriveItem.Click += (sender, args) => OpenDrive();
            accountActionItem.Click += (sender, args) => OpenControlCenter();
            var webItem = new ToolStripMenuItem("NAS 웹 열기");
            webItem.Click += (sender, args) => Program.OpenWebWithBrowserPicker(agentExe);
            var exitItem = new ToolStripMenuItem("NAS Drive 종료");
            exitItem.Click += (sender, args) => ExitNasDrive();

            var menu = new ContextMenuStrip();
            menu.Items.Add(accountItem);
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openDriveItem);
            menu.Items.Add(accountActionItem);
            menu.Items.Add(webItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            notifyIcon.ContextMenuStrip = menu;
            notifyIcon.Visible = true;
            notifyIcon.DoubleClick += (sender, args) => OpenControlCenter();
            refreshTimer.Interval = 2500;
            refreshTimer.Tick += (sender, args) => RefreshStatus();
            refreshTimer.Start();
            RefreshStatus();
        }

        private void RefreshStatus()
        {
            AccountSnapshot account = NativeControlCenter.ActiveAccount();
            EnsureAgentRunning(account);
            string state = NativeControlCenter.HealthState();
            string displayName = account == null ? "연결된 계정 없음" : (!string.IsNullOrWhiteSpace(account.DisplayName) ? account.DisplayName : account.LoginId);
            string stateText = state == "offline" ? "NAS 서버 오프라인"
                : state == "syncing" ? "동기화 중"
                : state == "needs-relink" ? "로그인 필요"
                : state == "error" ? "동기화 오류"
                : state == "paused" ? "동기화 일시 중지"
                : state == "connecting" ? "연결 중"
                : state == "updating" ? "업데이트 중"
                : "NAS와 동기화됨";
            accountItem.Text = displayName;
            statusItem.Text = stateText;
            openDriveItem.Enabled = account != null && !string.IsNullOrWhiteSpace(account.DrivePath) && Directory.Exists(account.DrivePath);
            accountActionItem.Text = account == null || state == "needs-relink" ? "로그인" : "상태 및 설정";
            string tooltip = "NAS Drive · " + stateText;
            notifyIcon.Text = tooltip.Length > 63 ? tooltip.Substring(0, 63) : tooltip;
            if (!string.Equals(currentVisualState, state, StringComparison.OrdinalIgnoreCase))
            {
                currentVisualState = state;
                Icon nextIcon = CreateStatusIcon(state);
                notifyIcon.Icon = nextIcon;
                if (currentIcon != null) currentIcon.Dispose();
                currentIcon = nextIcon;
            }
        }

        private void EnsureAgentRunning(AccountSnapshot account)
        {
            if (account == null || string.IsNullOrWhiteSpace(account.DeviceId) || !File.Exists(agentExe)) return;
            foreach (Process process in Process.GetProcessesByName("NAS-Sync-Agent"))
            {
                try
                {
                    if (!process.HasExited && Program.IsInstalledAgentProcessPath(process.MainModule.FileName, agentExe)) return;
                }
                catch { }
                finally { process.Dispose(); }
            }
            if ((DateTime.UtcNow - lastAgentStartAt).TotalSeconds < 8) return;
            lastAgentStartAt = DateTime.UtcNow;
            Program.StartInstalledAgent(agentExe, "--background");
        }

        private static Icon CreateStatusIcon(string state)
        {
            Color dot = state == "offline" || state == "error" || state == "needs-relink" ? Color.FromArgb(205, 62, 62)
                : state == "syncing" || state == "connecting" || state == "updating" ? Color.FromArgb(239, 158, 32)
                : Color.FromArgb(28, 104, 222);
            using (var bitmap = new Bitmap(32, 32))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (Icon baseIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application)
            {
                graphics.Clear(Color.Transparent);
                graphics.DrawIcon(baseIcon, new Rectangle(0, 0, 32, 32));
                using (var border = new SolidBrush(Color.White)) graphics.FillEllipse(border, 19, 19, 13, 13);
                using (var fill = new SolidBrush(dot)) graphics.FillEllipse(fill, 21, 21, 9, 9);
                IntPtr handle = bitmap.GetHicon();
                try { return (Icon)Icon.FromHandle(handle).Clone(); }
                finally { DestroyIcon(handle); }
            }
        }

        private void OpenDrive()
        {
            string drive = NativeControlCenter.FirstDrivePath();
            if (!string.IsNullOrWhiteSpace(drive) && Directory.Exists(drive)) Process.Start("explorer.exe", Program.QuoteArgument(drive));
            else OpenControlCenter();
        }

        private void OpenControlCenter()
        {
            Process.Start(new ProcessStartInfo(launcherExe, "--open") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
        }

        private void ExitNasDrive()
        {
            refreshTimer.Stop();
            notifyIcon.Visible = false;
            notifyIcon.Dispose();
            if (currentIcon != null) currentIcon.Dispose();
            Program.StopInstalledBackgroundProcesses(agentExe);
            ExitThread();
        }

        private static void StopLegacyTray()
        {
            string pidFile = Path.Combine(StateDir, "tray.pid");
            try
            {
                int pid;
                if (File.Exists(pidFile) && int.TryParse(File.ReadAllText(pidFile).Trim(), out pid))
                {
                    using (Process process = Process.GetProcessById(pid))
                    {
                        if (process.ProcessName.IndexOf("powershell", StringComparison.OrdinalIgnoreCase) >= 0) process.Kill();
                    }
                }
            }
            catch { }
            try { File.Delete(pidFile); } catch { }
        }
    }

    internal enum InstallState { FirstInstall, Upgrade, SameVersion, NewerInstalled, Repair }

    internal sealed class InstallerForm : Form
    {
        private static readonly Color BrandBlue = Color.FromArgb(26, 86, 219);
        private readonly string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "NAS Drive");
        private readonly string installedExe;
        private readonly string launcherExe;
        private readonly string versionFile;
        private readonly string stateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent");
        private readonly string pairingToken;
        private readonly InstallState installState;
        private readonly string installedVersion;
        private readonly Label title = new Label();
        private readonly Label description = new Label();
        private readonly Label versionText = new Label();
        private readonly Label statusText = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly CheckBox openAfter = new CheckBox();
        private readonly Button primary = new Button();
        private readonly Button cancel = new Button();
        private bool installationCompleted;

        internal InstallerForm()
        {
            installedExe = Path.Combine(installDir, "NAS-Sync-Agent.exe");
            launcherExe = Path.Combine(installDir, "NAS-Drive.exe");
            versionFile = Path.Combine(installDir, "agent-version.txt");
            pairingToken = ReadPairingToken();
            installedVersion = ReadInstalledVersion();
            installState = DetectInstallState();
            BuildUi();
            ApplyLandingState();
        }

        private void BuildUi()
        {
            AutoScaleMode = AutoScaleMode.None;
            Text = "NAS Drive 설치";
            ClientSize = new Size(660, 470);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.White;

            var header = new Panel { Location = new Point(0, 0), Size = new Size(660, 112), BackColor = BrandBlue };
            var brand = new Label { Text = "NAS DRIVE", Location = new Point(30, 20), Size = new Size(580, 25), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 11f) };
            var headerTitle = new Label { Text = "Windows용 NAS Drive", Location = new Point(28, 50), Size = new Size(590, 40), ForeColor = Color.White, Font = Program.UiFont("Segoe UI Semibold", 20f) };
            header.Controls.Add(brand);
            header.Controls.Add(headerTitle);

            title.Location = new Point(34, 142);
            title.Size = new Size(590, 38);
            title.Font = Program.UiFont("Segoe UI Semibold", 18f);

            description.Location = new Point(36, 190);
            description.Size = new Size(585, 58);
            description.Font = Program.UiFont("Segoe UI", 10f);
            description.ForeColor = Color.FromArgb(65, 72, 85);

            versionText.Location = new Point(36, 258);
            versionText.Size = new Size(585, 28);
            versionText.Font = Program.UiFont("Segoe UI", 9.5f);
            versionText.ForeColor = Color.DimGray;

            statusText.Location = new Point(36, 302);
            statusText.Size = new Size(585, 28);
            statusText.Font = Program.UiFont("Segoe UI Semibold", 9.5f);
            statusText.ForeColor = BrandBlue;

            progress.Location = new Point(36, 337);
            progress.Size = new Size(585, 20);
            progress.Style = ProgressBarStyle.Continuous;
            progress.Visible = false;

            openAfter.Text = "설치 완료 후 NAS Drive 열기";
            openAfter.Location = new Point(36, 374);
            openAfter.Size = new Size(330, 28);
            openAfter.Checked = true;
            openAfter.Visible = false;

            primary.Location = new Point(426, 414);
            primary.Size = new Size(195, 38);
            primary.BackColor = BrandBlue;
            primary.ForeColor = Color.White;
            primary.FlatStyle = FlatStyle.Flat;
            primary.Font = Program.UiFont("Segoe UI Semibold", 10f);
            primary.Click += async (sender, args) => await PrimaryClicked();

            cancel.Text = "취소";
            cancel.Location = new Point(321, 414);
            cancel.Size = new Size(95, 38);
            cancel.Click += (sender, args) => Close();

            Controls.Add(header);
            Controls.Add(title);
            Controls.Add(description);
            Controls.Add(versionText);
            Controls.Add(statusText);
            Controls.Add(progress);
            Controls.Add(openAfter);
            Controls.Add(primary);
            Controls.Add(cancel);
            AcceptButton = primary;
            CancelButton = cancel;
        }

        private void ApplyLandingState()
        {
            switch (installState)
            {
                case InstallState.FirstInstall:
                    title.Text = "NAS Drive를 설치합니다";
                    description.Text = "파일 탐색기에서 개인 NAS Drive를 사용하도록 이 Windows 계정에 설치합니다. 관리자 권한은 필요하지 않습니다.";
                    primary.Text = "설치";
                    statusText.Text = "설치 준비 완료";
                    break;
                case InstallState.Upgrade:
                    title.Text = "NAS Drive 업데이트가 있습니다";
                    description.Text = "설치된 버전을 안전하게 종료한 뒤 최신 버전으로 교체합니다. 계정 연결과 동기화 폴더는 유지됩니다.";
                    primary.Text = "업데이트";
                    statusText.Text = "업데이트 준비 완료";
                    break;
                case InstallState.SameVersion:
                    title.Text = "NAS Drive가 이미 설치되어 있습니다";
                    description.Text = "현재 PC에는 같은 버전이 정상적으로 설치되어 있습니다. 바로 NAS Drive를 열 수 있습니다.";
                    primary.Text = "NAS Drive 열기";
                    statusText.Text = "최신 버전입니다";
                    break;
                case InstallState.NewerInstalled:
                    title.Text = "더 최신 버전이 설치되어 있습니다";
                    description.Text = "현재 설치된 버전을 보호하기 위해 이전 버전으로 덮어쓰지 않습니다.";
                    primary.Text = "NAS Drive 열기";
                    statusText.Text = "다운그레이드가 차단되었습니다";
                    break;
                default:
                    title.Text = "NAS Drive를 복구 설치합니다";
                    description.Text = "같은 버전이지만 설치 파일이 달라 안전하게 다시 설치합니다. 계정 연결과 파일은 유지됩니다.";
                    primary.Text = "복구 설치";
                    statusText.Text = "복구 준비 완료";
                    break;
            }
            string displayedVersion = installedVersion;
            if (installState == InstallState.SameVersion && string.IsNullOrWhiteSpace(displayedVersion)) displayedVersion = Program.ProductVersion;
            versionText.Text = "설치된 버전: " + (string.IsNullOrWhiteSpace(displayedVersion) ? "없음 또는 이전 설치본" : displayedVersion) + "    |    설치할 버전: " + Program.ProductVersion;
        }

        private async Task PrimaryClicked()
        {
            if (installationCompleted)
            {
                RegisterWindowsIntegration();
                if (openAfter.Checked) LaunchAgent();
                ScheduleInstallerCleanup();
                Close();
                return;
            }
            if (installState == InstallState.SameVersion)
            {
                RepairLauncherIfNeeded();
                RegisterWindowsIntegration();
                LaunchAgent();
                ScheduleInstallerCleanup();
                Close();
                return;
            }
            if (installState == InstallState.NewerInstalled)
            {
                RegisterWindowsIntegration();
                LaunchAgent();
                ScheduleInstallerCleanup();
                Close();
                return;
            }

            primary.Enabled = false;
            cancel.Enabled = false;
            progress.Visible = true;
            openAfter.Visible = true;
            try
            {
                await Task.Run(() => InstallAgent());
                installationCompleted = true;
                title.Text = installState == InstallState.Upgrade ? "업데이트가 완료되었습니다" : "설치가 완료되었습니다";
                description.Text = "NAS Drive를 사용할 준비가 끝났습니다. 완료를 누르면 선택한 설정에 따라 NAS Drive를 엽니다.";
                statusText.Text = "설치 완료";
                progress.Value = 100;
                primary.Text = "완료";
                primary.Enabled = true;
                cancel.Visible = false;
            }
            catch (Exception ex)
            {
                title.Text = "설치를 완료하지 못했습니다";
                description.Text = ex.Message;
                statusText.Text = "기존 설치본은 가능한 경우 그대로 보존했습니다.";
                statusText.ForeColor = Color.FromArgb(190, 35, 45);
                primary.Text = "다시 시도";
                primary.Enabled = true;
                cancel.Enabled = true;
                openAfter.Visible = false;
            }
        }

        private void InstallAgent()
        {
            string tempDir = Path.Combine(Path.GetTempPath(), "NAS-Drive-Setup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);
            string extracted = Path.Combine(tempDir, "NAS-Sync-Agent.exe");
            string staged = installedExe + ".new";
            string backup = installedExe + ".previous";
            try
            {
                Report(5, "설치 패키지를 확인하는 중...");
                ExtractAgent(extracted);
                if (new FileInfo(extracted).Length < 1024 * 1024) throw new InvalidDataException("설치 패키지의 Agent 파일이 올바르지 않습니다.");
                VerifyAgent(extracted);
                Report(18, "실행 중인 NAS Drive를 안전하게 종료하는 중...");
                StopInstalledLauncher();
                StopInstalledAgent();
                StopInstalledProvider();
                Report(28, "이전 NAS Drive 설치 흔적을 정리하는 중...");
                CleanupLegacyComponents();
                Report(38, "프로그램 파일을 준비하는 중...");
                Directory.CreateDirectory(installDir);
                File.Copy(extracted, staged, true);
                Report(58, installState == InstallState.Upgrade ? "최신 버전으로 교체하는 중..." : "NAS Drive를 설치하는 중...");
                if (File.Exists(installedExe))
                {
                    if (File.Exists(backup)) File.Delete(backup);
                    File.Replace(staged, installedExe, backup, true);
                }
                else
                {
                    File.Move(staged, installedExe);
                }
                File.WriteAllText(versionFile, Program.ProductVersion);
                InstallLauncher();
                VerifyLauncherInstallation();
                Report(76, "Windows 시작 프로그램과 파일 탐색기 연결을 등록하는 중...");
                RegisterWindowsIntegration();
                Report(92, "설치 상태를 확인하는 중...");
                if (!File.Exists(installedExe) || ReadSha256(installedExe) != ReadSha256(extracted)) throw new IOException("설치된 파일 검증에 실패했습니다.");
                Report(100, "설치 완료");
                try { if (File.Exists(backup)) File.Delete(backup); } catch { }
            }
            catch
            {
                try
                {
                    if (File.Exists(backup))
                    {
                        if (File.Exists(installedExe)) File.Delete(installedExe);
                        File.Move(backup, installedExe);
                    }
                }
                catch { }
                throw;
            }
            finally
            {
                try { if (File.Exists(staged)) File.Delete(staged); } catch { }
                try { Directory.Delete(tempDir, true); } catch { }
            }
        }

        private void InstallLauncher()
        {
            string staged = launcherExe + ".new";
            File.Copy(Application.ExecutablePath, staged, true);
            if (File.Exists(launcherExe))
            {
                string backup = launcherExe + ".previous";
                try { if (File.Exists(backup)) File.Delete(backup); } catch { }
                File.Replace(staged, launcherExe, backup, true);
                try { if (File.Exists(backup)) File.Delete(backup); } catch { }
            }
            else File.Move(staged, launcherExe);
        }

        private bool IsLauncherHealthy()
        {
            try
            {
                if (!File.Exists(launcherExe) || !File.Exists(installedExe)) return false;
                if (string.Equals(ReadSha256(launcherExe), ReadSha256(installedExe), StringComparison.OrdinalIgnoreCase)) return false;
                string version = FileVersionInfo.GetVersionInfo(launcherExe).FileVersion ?? "";
                return version.StartsWith(Program.ProductVersion + ".", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(version, Program.ProductVersion, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private void VerifyLauncherInstallation()
        {
            if (!IsLauncherHealthy()) throw new InvalidDataException("NAS Drive 트레이 런처 설치 검증에 실패했습니다.");
        }

        private void RepairLauncherIfNeeded()
        {
            if (IsLauncherHealthy()) return;
            StopInstalledLauncher();
            InstallLauncher();
            VerifyLauncherInstallation();
        }

        private void Report(int value, string text)
        {
            BeginInvoke((Action)(() => { progress.Value = Math.Max(0, Math.Min(100, value)); statusText.Text = text; }));
        }

        private void ExtractAgent(string output)
        {
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("NasDrive.Agent"))
            {
                if (input == null) throw new InvalidDataException("설치 패키지에 NAS Drive Agent가 없습니다.");
                using (var target = File.Create(output)) input.CopyTo(target);
            }
        }

        private static void VerifyAgent(string agentPath)
        {
            using (var process = new Process())
            {
                process.StartInfo = new ProcessStartInfo(agentPath, "--self-test")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                if (!process.Start()) throw new InvalidDataException("NAS Drive Agent 사전 검증을 시작하지 못했습니다.");
                if (!process.WaitForExit(30000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("NAS Drive Agent 사전 검증 시간이 초과되었습니다.");
                }
                if (process.ExitCode != 0) throw new InvalidDataException("NAS Drive Agent 사전 검증에 실패했습니다.");
            }
        }

        private void StopInstalledAgent()
        {
            Directory.CreateDirectory(stateDir);
            StopLegacyTrayProcess();
            long unixMilliseconds = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            File.WriteAllText(Path.Combine(stateDir, "agent.exit"), unixMilliseconds.ToString());
            DateTime deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                if (!IsInstalledAgentRunning()) break;
                Thread.Sleep(250);
            }
            foreach (Process process in Process.GetProcessesByName("NAS-Sync-Agent"))
            {
                try
                {
                    if (string.Equals(process.MainModule.FileName, installedExe, StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch { }
                finally { process.Dispose(); }
            }
            try { File.Delete(Path.Combine(stateDir, "agent.exit")); } catch { }
        }

        private void StopLegacyTrayProcess()
        {
            string pidFile = Path.Combine(stateDir, "tray.pid");
            try
            {
                int pid;
                if (!File.Exists(pidFile) || !int.TryParse(File.ReadAllText(pidFile).Trim(), out pid)) return;
                using (Process process = Process.GetProcessById(pid))
                {
                    if (process.ProcessName.IndexOf("powershell", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
            }
            catch { }
            finally { try { File.Delete(pidFile); } catch { } }
        }

        private void StopInstalledLauncher()
        {
            foreach (Process process in Process.GetProcessesByName("NAS-Drive"))
            {
                try
                {
                    string processPath = process.MainModule.FileName;
                    if (!Program.IsInstalledLauncherProcessPath(processPath, launcherExe)) continue;
                    try { process.CloseMainWindow(); } catch { }
                    if (!process.WaitForExit(1500)) process.Kill();
                    process.WaitForExit(3000);
                }
                catch { }
                finally { process.Dispose(); }
            }
        }

        private void StopInstalledProvider()
        {
            string providerExe = Path.Combine(installDir, "NAS-Drive-Provider.exe");
            foreach (Process process in Process.GetProcessesByName("NAS-Drive-Provider"))
            {
                try
                {
                    if (!string.Equals(process.MainModule.FileName, providerExe, StringComparison.OrdinalIgnoreCase)) continue;
                    process.Kill();
                    process.WaitForExit(3000);
                }
                catch { }
                finally { process.Dispose(); }
            }
        }

        private void CleanupLegacyComponents()
        {
            foreach (string pattern in new[] { "NAS-Sync-Agent_pair_*.b64", "NAS-Sync-Agent_pair_*.ps1" })
            {
                try
                {
                    foreach (string file in Directory.GetFiles(stateDir, pattern, SearchOption.TopDirectoryOnly))
                    {
                        try { File.Delete(file); } catch { }
                    }
                }
                catch { }
            }
            foreach (string fileName in new[] { "NAS-Sync-Agent.exe", "agent.pid", "foreground.pid", "tray.pid", "agent.exit" })
            {
                try { File.Delete(Path.Combine(stateDir, fileName)); } catch { }
            }
            try
            {
                foreach (string directory in Directory.GetDirectories(stateDir, "legacy-install-artifacts-*", SearchOption.TopDirectoryOnly))
                {
                    try { Directory.Delete(directory, true); } catch { }
                }
            }
            catch { }

            string localPrograms = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
            foreach (string legacyDirectory in new[]
            {
                Path.Combine(localPrograms, "NAS Sync Agent"),
                Path.Combine(localPrograms, "NAS-Sync-Agent")
            })
            {
                try { if (Directory.Exists(legacyDirectory)) Directory.Delete(legacyDirectory, true); } catch { }
            }

            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            {
                run.DeleteValue("NAS Sync Agent", false);
                run.DeleteValue("NAS Sync Agent Tray", false);
            }
            foreach (string shortcutDirectory in new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs)
            })
            {
                foreach (string shortcutName in new[] { "NAS Sync Agent.lnk", "NAS Drive Agent.lnk" })
                {
                    try { File.Delete(Path.Combine(shortcutDirectory, shortcutName)); } catch { }
                }
            }
        }

        private bool IsInstalledAgentRunning()
        {
            foreach (Process process in Process.GetProcessesByName("NAS-Sync-Agent"))
            {
                try { if (string.Equals(process.MainModule.FileName, installedExe, StringComparison.OrdinalIgnoreCase)) return true; }
                catch { }
                finally { process.Dispose(); }
            }
            return false;
        }

        private void RegisterWindowsIntegration()
        {
            string handler = File.Exists(launcherExe) ? launcherExe : installedExe;
            string startCommand = "\"" + handler + "\" --background";
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) run.SetValue("NAS Drive", startCommand);
            using (RegistryKey protocol = Registry.CurrentUser.CreateSubKey(@"Software\Classes\nas-sync"))
            {
                protocol.SetValue("", "URL:NAS Drive");
                protocol.SetValue("URL Protocol", "");
            }
            string protocolCommand = "\"" + handler + "\" \"%1\"";
            using (RegistryKey command = Registry.CurrentUser.CreateSubKey(@"Software\Classes\nas-sync\shell\open\command")) command.SetValue("", protocolCommand);

            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType != null)
            {
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(Path.Combine(desktop, "NAS Drive.lnk"));
                shortcut.TargetPath = handler;
                shortcut.Arguments = File.Exists(launcherExe) ? "--open" : "--hidden-bootstrap";
                shortcut.WorkingDirectory = installDir;
                shortcut.IconLocation = File.Exists(launcherExe) ? launcherExe : installedExe;
                shortcut.Save();
            }
        }

        private void LaunchAgent()
        {
            if (!File.Exists(installedExe)) return;
            bool useLauncher = string.IsNullOrWhiteSpace(pairingToken) && File.Exists(launcherExe);
            if (useLauncher)
            {
                Process.Start(new ProcessStartInfo(launcherExe, "--background")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = Path.GetDirectoryName(launcherExe)
                });
            }
            var info = new ProcessStartInfo(useLauncher ? launcherExe : installedExe) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
            info.Arguments = useLauncher
                ? "--open"
                : "--pairing-token " + pairingToken + " --auto-setup --hidden-bootstrap";
            Process.Start(info);
        }

        private void ScheduleInstallerCleanup()
        {
            try
            {
                if (!File.Exists(launcherExe)) return;
                var info = new ProcessStartInfo(launcherExe, "--cleanup-installers " + Program.QuoteArgument(Application.ExecutablePath))
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = installDir
                };
                Process.Start(info);
            }
            catch { }
        }

        private InstallState DetectInstallState()
        {
            bool installedExists = File.Exists(installedExe);
            string installedHash = "";
            string embeddedHash = "";
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("NasDrive.Agent")) embeddedHash = ReadSha256(stream);
                if (installedExists) installedHash = ReadSha256(installedExe);
            }
            catch { }
            return Program.ResolveInstallState(installedExists, installedVersion, installedHash, embeddedHash);
        }

        private string ReadInstalledVersion()
        {
            try { return File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : ""; }
            catch { return ""; }
        }

        private static string ReadPairingToken()
        {
            Match match = Regex.Match(Path.GetFileNameWithoutExtension(Application.ExecutablePath), @"pair_[A-Za-z0-9_-]+", RegexOptions.IgnoreCase);
            return match.Success ? match.Value : "";
        }

        private static string ReadSha256(string file)
        {
            using (var stream = File.OpenRead(file)) return ReadSha256(stream);
        }

        private static string ReadSha256(Stream stream)
        {
            using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }
}
