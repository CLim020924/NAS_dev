using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Reflection;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;
using Windows.Win32.Storage.FileSystem;
using Windows.Security.Cryptography;
using Windows.Storage;
using Windows.Storage.Provider;

namespace NASDrive.Provider;

internal static class Program
{
    private static readonly Guid ProviderId = new("c16cc9e7-28db-45e0-9951-24c7117848b4");
    private static unsafe readonly CF_CALLBACK FetchDataCallback = OnFetchData;
    private static ProviderContext? ActiveContext;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, string? item1, IntPtr item2);

    [DllImport("propsys.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int PSGetPropertyKeyFromName(string canonicalName, out PropertyKey propertyKey);

    private const uint ShcneUpdateDir = 0x00001000;
    private const uint ShcneCreate = 0x00000002;
    private const uint ShcneMkdir = 0x00000008;
    private const uint ShcneAssocChanged = 0x08000000;
    private const uint ShcnfIdList = 0x0000;
    private const uint ShcnfPathW = 0x0005;
    private const uint ShcnfFlush = 0x1000;

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [ComImport]
    [Guid("D8EC27BB-3F3B-4042-B10A-4ACFD924D453")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IColumnManager
    {
        [PreserveSig] int SetColumnInfo(ref PropertyKey propertyKey, IntPtr columnInfo);
        [PreserveSig] int GetColumnInfo(ref PropertyKey propertyKey, IntPtr columnInfo);
        [PreserveSig] int GetColumnCount(uint flags, out uint count);
        [PreserveSig] int GetColumns(uint flags, [Out] PropertyKey[] propertyKeys, uint count);
        [PreserveSig] int SetColumns([In] PropertyKey[] propertyKeys, uint count);
    }

    [ComImport]
    [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IComServiceProvider
    {
        [PreserveSig] int QueryService(ref Guid service, ref Guid interfaceId, out IntPtr result);
    }

    [ComImport]
    [Guid("000214E2-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellBrowser
    {
        [PreserveSig] int GetWindow(out IntPtr windowHandle);
        [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enterMode);
        [PreserveSig] int InsertMenusSB(IntPtr sharedMenu, IntPtr menuWidths);
        [PreserveSig] int SetMenuSB(IntPtr sharedMenu, IntPtr reserved, IntPtr activeObject);
        [PreserveSig] int RemoveMenusSB(IntPtr sharedMenu);
        [PreserveSig] int SetStatusTextSB([MarshalAs(UnmanagedType.LPWStr)] string statusText);
        [PreserveSig] int EnableModelessSB([MarshalAs(UnmanagedType.Bool)] bool enable);
        [PreserveSig] int TranslateAcceleratorSB(IntPtr message, ushort commandId);
        [PreserveSig] int BrowseObject(IntPtr itemIdList, uint flags);
        [PreserveSig] int GetViewStateStream(uint mode, out IntPtr stream);
        [PreserveSig] int GetControlWindow(uint controlId, out IntPtr windowHandle);
        [PreserveSig] int SendControlMsg(uint controlId, uint message, IntPtr wParam, IntPtr lParam, out IntPtr result);
        [PreserveSig] int QueryActiveShellView(out IntPtr shellView);
        [PreserveSig] int OnViewWindowActive(IntPtr shellView);
        [PreserveSig] int SetToolbarItems(IntPtr buttons, uint buttonCount, uint flags);
    }

    private sealed record ProviderContext(string Root, string ServerBase, string DeviceId, string SyncRootId, string AgentToken);
    private sealed record ManifestEntry(string Type, string RelPath, long Size, long MtimeMs);
    private sealed record ProviderCommand(string Operation, string RelPath = "", string Identity = "", string ManifestPath = "");
    private sealed record ProviderCommandResult(bool Success, string Error = "");

    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 16299))
                throw new PlatformNotSupportedException("NAS Drive requires Windows 10 version 1709 or newer.");

            var command = args.FirstOrDefault()?.ToLowerInvariant() ?? "";
            var options = ParseOptions(args.Skip(1));
            return command switch
            {
                "register" => Register(options),
                "unregister" => Unregister(options),
                "open" => Open(options),
                "configure-view" => ConfigureExplorerView(options),
                "mark-in-sync" => MarkInSync(options),
                "set-status" => SetStatus(options),
                "sync-placeholders" => SyncPlaceholders(options),
                "serve" => Serve(options),
                "self-test" => SelfTest(),
                "pin" => SetPin(options, true),
                "free-space" => SetPin(options, false),
                _ => Usage()
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static Dictionary<string, string> ParseOptions(IEnumerable<string> args)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var values = args.ToArray();
        for (var index = 0; index < values.Length; index++)
        {
            if (!values[index].StartsWith("--", StringComparison.Ordinal)) continue;
            var key = values[index][2..];
            var value = index + 1 < values.Length && !values[index + 1].StartsWith("--", StringComparison.Ordinal)
                ? values[++index]
                : "true";
            result[key] = value;
        }
        return result;
    }

    private static string Required(IReadOnlyDictionary<string, string> options, string key)
        => options.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException($"--{key} is required.");

    private static int Register(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        var account = Required(options, "account");
        var displayName = options.GetValueOrDefault("display-name", $"NAS Drive - {account}");
        Directory.CreateDirectory(root);
        if (!StorageProviderSyncRootManager.IsSupported())
            throw new PlatformNotSupportedException("Windows Storage Provider sync roots are not supported on this device.");

        var folder = StorageFolder.GetFolderFromPathAsync(root).AsTask().GetAwaiter().GetResult();
        var installDir = Path.GetDirectoryName(Environment.ProcessPath) ?? string.Empty;
        var brandedIcon = Path.Combine(installDir, "nas-drive.ico");
        var iconSource = File.Exists(brandedIcon) ? brandedIcon : Environment.ProcessPath ?? string.Empty;
        var info = new StorageProviderSyncRootInfo
        {
            Id = SyncRootRegistrationId(account),
            Path = folder,
            DisplayNameResource = displayName,
            IconResource = $"{iconSource},0",
            HydrationPolicy = StorageProviderHydrationPolicy.Full,
            HydrationPolicyModifier = StorageProviderHydrationPolicyModifier.AutoDehydrationAllowed,
            PopulationPolicy = StorageProviderPopulationPolicy.AlwaysFull,
            InSyncPolicy = StorageProviderInSyncPolicy.FileCreationTime |
                           StorageProviderInSyncPolicy.FileLastWriteTime |
                           StorageProviderInSyncPolicy.DirectoryCreationTime |
                           StorageProviderInSyncPolicy.DirectoryLastWriteTime,
            Version = "1.4.1",
            ShowSiblingsAsGroup = false,
            HardlinkPolicy = StorageProviderHardlinkPolicy.None,
            AllowPinning = true,
            ProviderId = ProviderId,
            Context = CryptographicBuffer.ConvertStringToBinary($"{account}|{root}", BinaryStringEncoding.Utf8)
        };
        StorageProviderSyncRootManager.Register(info);
        RemoveExplorerRegistration(account);
        SHChangeNotify(ShcneAssocChanged, ShcnfIdList, null, IntPtr.Zero);
        Console.WriteLine(root);
        return 0;
    }

    private static int SelfTest()
    {
        if (!StorageProviderSyncRootManager.IsSupported())
            throw new InvalidOperationException("Windows Storage Provider sync root registration is unavailable.");
        if (!SyncRootRegistrationId("account").Contains($"!{WindowsIdentity.GetCurrent().User?.Value}!", StringComparison.Ordinal))
            throw new InvalidOperationException("Sync-root registration ID must remain bound to the current Windows user SID.");
        var testRoot = Path.Combine(Path.GetTempPath(), "NAS Drive State Test");
        if (!IsSameOrDescendant(testRoot, Path.Combine(testRoot, "하위 폴더")) ||
            IsSameOrDescendant(testRoot, testRoot + "-other"))
            throw new InvalidOperationException("Explorer status-column path boundary test failed.");
        Console.WriteLine("NAS Drive Provider self-test passed.");
        return 0;
    }

    private static unsafe int ConfigureExplorerView(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root")).TrimEnd(Path.DirectorySeparatorChar);
        return ConfigureExplorerViewCore(root);
    }

    private static unsafe int ConfigureExplorerViewCore(string root)
    {
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        var columns = new[]
        {
            PropertyKeyFromName("System.ItemNameDisplay"),
            PropertyKeyFromName("System.StorageProviderUIStatus"),
            PropertyKeyFromName("System.DateModified"),
            PropertyKeyFromName("System.ItemTypeText"),
            PropertyKeyFromName("System.Size")
        };

        var shellType = Type.GetTypeFromProgID("Shell.Application")
            ?? throw new InvalidOperationException("Windows Shell automation is unavailable.");
        object? shell = null;
        object? windows = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            windows = shellType.InvokeMember("Windows", BindingFlags.InvokeMethod, null, shell, null);
            if (windows is null) return 0;
            var windowsType = windows.GetType();
            var count = Convert.ToInt32(windowsType.InvokeMember("Count", BindingFlags.GetProperty, null, windows, null));
            var configured = 0;
            for (var index = 0; index < count; index++)
            {
                object? window = null;
                object? document = null;
                object? folder = null;
                object? self = null;
                try
                {
                    window = windowsType.InvokeMember("Item", BindingFlags.InvokeMethod, null, windows, new object[] { index });
                    if (window is null) continue;
                    var windowType = window.GetType();
                    document = windowType.InvokeMember("Document", BindingFlags.GetProperty, null, window, null);
                    if (document is null) continue;
                    var documentType = document.GetType();
                    folder = documentType.InvokeMember("Folder", BindingFlags.GetProperty, null, document, null);
                    if (folder is null) continue;
                    self = folder.GetType().InvokeMember("Self", BindingFlags.GetProperty, null, folder, null);
                    if (self is null) continue;
                    var path = Convert.ToString(self.GetType().InvokeMember("Path", BindingFlags.GetProperty, null, self, null));
                    var openPath = Path.GetFullPath(path ?? "").TrimEnd(Path.DirectorySeparatorChar);
                    if (!IsSameOrDescendant(root, openPath)) continue;

                    var unknownPointer = Marshal.GetIUnknownForObject(window);
                    try
                    {
                        var serviceProviderId = new Guid("6D5140C1-7436-11CE-8034-00AA006009FA");
                        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknownPointer, ref serviceProviderId, out var serviceProviderPointer));
                        try
                        {
                            var service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
                            var shellBrowserId = new Guid("000214E2-0000-0000-C000-000000000046");
                            IntPtr browserPointer = IntPtr.Zero;
                            var queryService = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, Guid*, IntPtr*, int>)(*(IntPtr**)serviceProviderPointer)[3];
                            Marshal.ThrowExceptionForHR(queryService(serviceProviderPointer, &service, &shellBrowserId, &browserPointer));
                            try
                            {
                                IntPtr viewPointer = IntPtr.Zero;
                                var queryActiveShellView = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)(*(IntPtr**)browserPointer)[15];
                                Marshal.ThrowExceptionForHR(queryActiveShellView(browserPointer, &viewPointer));
                                try
                                {
                                    var managerId = new Guid("D8EC27BB-3F3B-4042-B10A-4ACFD924D453");
                                    Marshal.ThrowExceptionForHR(Marshal.QueryInterface(viewPointer, ref managerId, out var managerPointer));
                                    try
                                    {
                                        fixed (PropertyKey* columnPointer = columns)
                                        {
                                            var setColumns = (delegate* unmanaged[Stdcall]<IntPtr, PropertyKey*, uint, int>)(*(IntPtr**)managerPointer)[7];
                                            Marshal.ThrowExceptionForHR(setColumns(managerPointer, columnPointer, checked((uint)columns.Length)));
                                        }
                                    }
                                    finally
                                    {
                                        if (managerPointer != IntPtr.Zero) Marshal.Release(managerPointer);
                                    }
                                }
                                finally
                                {
                                    if (viewPointer != IntPtr.Zero) Marshal.Release(viewPointer);
                                }
                            }
                            finally
                            {
                                if (browserPointer != IntPtr.Zero) Marshal.Release(browserPointer);
                            }
                        }
                        finally
                        {
                            if (serviceProviderPointer != IntPtr.Zero) Marshal.Release(serviceProviderPointer);
                        }
                    }
                    finally
                    {
                        Marshal.Release(unknownPointer);
                    }
                    windowType.InvokeMember("Refresh", BindingFlags.InvokeMethod, null, window, null);
                    configured++;
                }
                catch (COMException ex)
                {
                    // Ignore non-Explorer Shell windows and views that do not expose IColumnManager.
                    Console.Error.WriteLine($"Explorer view configuration skipped: 0x{ex.HResult:X8} {ex.Message}");
                }
                finally
                {
                    ReleaseComObject(self);
                    ReleaseComObject(folder);
                    ReleaseComObject(document);
                    ReleaseComObject(window);
                }
            }
            Console.WriteLine(configured);
            return 0;
        }
        finally
        {
            ReleaseComObject(windows);
            ReleaseComObject(shell);
        }
    }

    private static PropertyKey PropertyKeyFromName(string canonicalName)
    {
        Marshal.ThrowExceptionForHR(PSGetPropertyKeyFromName(canonicalName, out var key));
        return key;
    }

    private static void ReleaseComObject(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }

    private static unsafe int SyncPlaceholders(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        var manifestPath = Path.GetFullPath(Required(options, "manifest"));
        SyncPlaceholdersCore(root, manifestPath);
        return 0;
    }

    private static unsafe void SyncPlaceholdersCore(string root, string manifestPath)
    {
        Directory.CreateDirectory(root);
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath, Encoding.UTF8));
        var entries = new List<ManifestEntry>();
        foreach (var item in document.RootElement.GetProperty("entries").EnumerateArray())
        {
            var type = item.GetProperty("type").GetString() ?? "";
            var relPath = NormalizeRelativePath(item.GetProperty("relPath").GetString() ?? "");
            var size = item.TryGetProperty("size", out var sizeValue) ? sizeValue.GetInt64() : 0;
            var mtime = item.TryGetProperty("mtimeMs", out var timeValue) ? timeValue.GetInt64() : 0;
            if (relPath.Length > 0 && (type == "folder" || type == "file")) entries.Add(new(type, relPath, size, mtime));
        }

        foreach (var entry in entries.OrderBy(x => x.RelPath.Count(c => c == '/')).ThenBy(x => x.Type == "folder" ? 0 : 1))
        {
            var relativeOs = entry.RelPath.Replace('/', Path.DirectorySeparatorChar);
            var fullPath = Path.GetFullPath(Path.Combine(root, relativeOs));
            EnsureInside(root, fullPath);
            if (File.Exists(fullPath) || Directory.Exists(fullPath))
            {
                // Older agent versions created remote folders as ordinary directories.
                // Promote only manifest-confirmed directories so Explorer can render an
                // authoritative CFAPI state without risking a local file conflict.
                if (entry.Type == "folder" &&
                    (File.GetAttributes(fullPath) & System.IO.FileAttributes.ReparsePoint) == 0)
                {
                    CommitLocalEntry(fullPath, entry.RelPath);
                    ClearExplorerItemState(fullPath);
                }
                continue;
            }
            var parent = Path.GetDirectoryName(fullPath) ?? root;
            Directory.CreateDirectory(parent);
            CreatePlaceholder(parent, Path.GetFileName(fullPath), entry);
            SHChangeNotify(entry.Type == "folder" ? ShcneMkdir : ShcneCreate,
                ShcnfPathW | ShcnfFlush, fullPath, IntPtr.Zero);
            SHChangeNotify(ShcneUpdateDir, ShcnfPathW, parent, IntPtr.Zero);
        }
        SHChangeNotify(ShcneUpdateDir, ShcnfPathW | ShcnfFlush, root, IntPtr.Zero);
    }

    private static unsafe void CreatePlaceholder(string parent, string name, ManifestEntry entry)
    {
        var identity = Encoding.UTF8.GetBytes(entry.RelPath);
        var timestamp = entry.MtimeMs > 0
            ? DateTimeOffset.FromUnixTimeMilliseconds(entry.MtimeMs).UtcDateTime.ToFileTimeUtc()
            : DateTime.UtcNow.ToFileTimeUtc();
        fixed (char* namePointer = name)
        fixed (byte* identityPointer = identity)
        {
            var info = new CF_PLACEHOLDER_CREATE_INFO
            {
                RelativeFileName = namePointer,
                FsMetadata = new CF_FS_METADATA
                {
                    BasicInfo = new FILE_BASIC_INFO
                    {
                        CreationTime = timestamp,
                        LastAccessTime = timestamp,
                        LastWriteTime = timestamp,
                        ChangeTime = timestamp,
                        FileAttributes = entry.Type == "folder" ? 0x10u : 0x20u
                    },
                    FileSize = entry.Type == "folder" ? 0 : Math.Max(0, entry.Size)
                },
                FileIdentity = identityPointer,
                FileIdentityLength = (uint)identity.Length,
                Flags = entry.Type == "folder"
                    ? CF_PLACEHOLDER_CREATE_FLAGS.CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC |
                      CF_PLACEHOLDER_CREATE_FLAGS.CF_PLACEHOLDER_CREATE_FLAG_DISABLE_ON_DEMAND_POPULATION
                    : CF_PLACEHOLDER_CREATE_FLAGS.CF_PLACEHOLDER_CREATE_FLAG_MARK_IN_SYNC
            };
            var hr = PInvoke.CfCreatePlaceholders(parent, new ReadOnlySpan<CF_PLACEHOLDER_CREATE_INFO>(&info, 1), CF_CREATE_FLAGS.CF_CREATE_FLAG_NONE, out var processed);
            Marshal.ThrowExceptionForHR(hr);
            if (processed != 1 || info.Result.Failed) Marshal.ThrowExceptionForHR(info.Result);
        }
    }

    private static unsafe int Serve(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        ActiveContext = new ProviderContext(
            root,
            Required(options, "server-base").TrimEnd('/'),
            Required(options, "device-id"),
            Required(options, "sync-root-id"),
            UnprotectToken(Path.GetFullPath(Required(options, "token-file")))
        );
        var callbacks = new[]
        {
            new CF_CALLBACK_REGISTRATION { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_FETCH_DATA, Callback = FetchDataCallback },
            new CF_CALLBACK_REGISTRATION { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NONE, Callback = null! }
        };
        var hr = PInvoke.CfConnectSyncRoot(root, callbacks, null,
            CF_CONNECT_FLAGS.CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO | CF_CONNECT_FLAGS.CF_CONNECT_FLAG_REQUIRE_FULL_FILE_PATH,
            out var connectionKey);
        Marshal.ThrowExceptionForHR(hr);
        using var commandCancellation = new CancellationTokenSource();
        _ = RunCommandPipeAsync(ActiveContext, commandCancellation.Token);
        Console.WriteLine($"READY {root}");
        using var quit = new ManualResetEventSlim(false);
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; quit.Set(); };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => quit.Set();
        quit.Wait();
        commandCancellation.Cancel();
        PInvoke.CfDisconnectSyncRoot(connectionKey);
        return 0;
    }

    private static string CommandPipeName(string syncRootId)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(syncRootId));
        return $"NASDrive_{Convert.ToHexString(digest)[..24]}";
    }

    private static async Task RunCommandPipeAsync(ProviderContext context, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    CommandPipeName(context.SyncRootId),
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(cancellationToken);
                using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, leaveOpen: true);
                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
                var line = await reader.ReadLineAsync(cancellationToken);
                var result = ExecuteProviderCommand(context, line ?? "");
                await writer.WriteLineAsync(JsonSerializer.Serialize(result, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                }));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Provider command pipe failed: {ex.Message}");
                await Task.Delay(250, cancellationToken).ContinueWith(_ => { }, TaskScheduler.Default);
            }
        }
    }

    private static ProviderCommandResult ExecuteProviderCommand(ProviderContext context, string payload)
    {
        try
        {
            var command = JsonSerializer.Deserialize<ProviderCommand>(payload, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? throw new InvalidOperationException("Missing provider command.");
            if (command.Operation.Equals("sync-manifest", StringComparison.OrdinalIgnoreCase))
            {
                var manifestPath = ValidateProviderManifestPath(command.ManifestPath);
                SyncPlaceholdersCore(context.Root, manifestPath);
                return new ProviderCommandResult(true);
            }
            if (command.Operation.Equals("configure-view", StringComparison.OrdinalIgnoreCase))
            {
                ConfigureExplorerViewCore(context.Root);
                return new ProviderCommandResult(true);
            }
            var relPath = NormalizeRelativePath(command.RelPath);
            if (relPath.Length == 0) throw new InvalidOperationException("Invalid provider command path.");
            var target = Path.GetFullPath(Path.Combine(context.Root, relPath.Replace('/', Path.DirectorySeparatorChar)));
            EnsureInside(context.Root, target);
            if (!File.Exists(target) && !Directory.Exists(target)) throw new FileNotFoundException("Provider command target is missing.", target);

            switch (command.Operation.ToLowerInvariant())
            {
                case "dirty":
                    SetInSyncState(target, false);
                    SetExplorerItemState(target, "동기화 중", "shell32.dll,-16739");
                    break;
                case "commit":
                    CommitLocalEntry(target, command.Identity.Length > 0 ? command.Identity : relPath);
                    ClearExplorerItemState(target);
                    break;
                default:
                    throw new InvalidOperationException("Unsupported provider command.");
            }
            SHChangeNotify(ShcneUpdateDir, ShcnfPathW | ShcnfFlush, Path.GetDirectoryName(target) ?? context.Root, IntPtr.Zero);
            return new ProviderCommandResult(true);
        }
        catch (Exception ex)
        {
            return new ProviderCommandResult(false, ex.Message);
        }
    }

    private static string ValidateProviderManifestPath(string value)
    {
        var candidate = Path.GetFullPath(value);
        var stateRoot = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAS-Sync-Agent"));
        var normalizedRoot = stateRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fileName = Path.GetFileName(candidate);
        if (!candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
            !fileName.StartsWith("manifest-", StringComparison.OrdinalIgnoreCase) ||
            !fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Provider manifest path is outside the NAS Drive state directory.");
        if (!File.Exists(candidate)) throw new FileNotFoundException("Provider manifest is missing.", candidate);
        return candidate;
    }

    private static unsafe void CommitLocalEntry(string target, string identityValue)
    {
        using var handle = OpenCloudFileHandle(target);
        var nativeHandle = new HANDLE(handle.DangerousGetHandle());
        var attributes = File.GetAttributes(target);
        if ((attributes & System.IO.FileAttributes.ReparsePoint) != 0)
        {
            var inSyncHr = PInvoke.CfSetInSyncState(nativeHandle, CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_IN_SYNC,
                CF_SET_IN_SYNC_FLAGS.CF_SET_IN_SYNC_FLAG_NONE, null);
            Marshal.ThrowExceptionForHR(inSyncHr);
            return;
        }

        var identity = Encoding.UTF8.GetBytes(NormalizeRelativePath(identityValue));
        var hr = PInvoke.CfConvertToPlaceholder(handle, identity,
            CF_CONVERT_FLAGS.CF_CONVERT_FLAG_MARK_IN_SYNC);
        Marshal.ThrowExceptionForHR(hr);
    }

    private static unsafe void SetInSyncState(string target, bool inSync)
    {
        if ((File.GetAttributes(target) & System.IO.FileAttributes.ReparsePoint) == 0) return;
        using var handle = OpenCloudFileHandle(target);
        var hr = PInvoke.CfSetInSyncState(new HANDLE(handle.DangerousGetHandle()),
            inSync ? CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_IN_SYNC : CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_NOT_IN_SYNC,
            CF_SET_IN_SYNC_FLAGS.CF_SET_IN_SYNC_FLAG_NONE, null);
        Marshal.ThrowExceptionForHR(hr);
    }

    private static void SetExplorerItemState(string target, string value, string iconResource)
    {
        try
        {
            IStorageItem item = Directory.Exists(target)
                ? StorageFolder.GetFolderFromPathAsync(target).AsTask().GetAwaiter().GetResult()
                : StorageFile.GetFileFromPathAsync(target).AsTask().GetAwaiter().GetResult();
            var property = new StorageProviderItemProperty
            {
                Id = 2,
                Value = value,
                IconResource = iconResource
            };
            StorageProviderItemProperties.SetAsync(item, new[] { property }).AsTask().GetAwaiter().GetResult();
        }
        catch
        {
            // CFAPI in-sync state remains authoritative when custom state UI is unavailable.
        }
    }

    private static void ClearExplorerItemState(string target)
    {
        try
        {
            IStorageItem item = Directory.Exists(target)
                ? StorageFolder.GetFolderFromPathAsync(target).AsTask().GetAwaiter().GetResult()
                : StorageFile.GetFileFromPathAsync(target).AsTask().GetAwaiter().GetResult();
            StorageProviderItemProperties.SetAsync(item, Array.Empty<StorageProviderItemProperty>())
                .AsTask().GetAwaiter().GetResult();
        }
        catch
        {
            // The standard CFAPI state remains usable on systems without custom item properties.
        }
    }

    private static unsafe Microsoft.Win32.SafeHandles.SafeFileHandle OpenCloudFileHandle(string target)
    {
        var handle = PInvoke.CreateFile(target,
            0xC0000000u, // GENERIC_READ | GENERIC_WRITE; CfConvertToPlaceholder requires write access.
            FILE_SHARE_MODE.FILE_SHARE_READ | FILE_SHARE_MODE.FILE_SHARE_WRITE | FILE_SHARE_MODE.FILE_SHARE_DELETE,
            null,
            FILE_CREATION_DISPOSITION.OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES.FILE_FLAG_BACKUP_SEMANTICS,
            null);
        if (handle.IsInvalid) Marshal.ThrowExceptionForHR(Marshal.GetHRForLastWin32Error());
        return handle;
    }

    private static unsafe void OnFetchData(CF_CALLBACK_INFO* callbackInfo, CF_CALLBACK_PARAMETERS* callbackParameters)
    {
        if (callbackInfo is null || callbackParameters is null || ActiveContext is null) return;
        var context = ActiveContext;
        var identity = callbackInfo->FileIdentity is not null && callbackInfo->FileIdentityLength > 0
            ? Encoding.UTF8.GetString(new ReadOnlySpan<byte>(callbackInfo->FileIdentity, checked((int)callbackInfo->FileIdentityLength)))
            : "";
        var connectionKey = callbackInfo->ConnectionKey;
        var transferKey = callbackInfo->TransferKey;
        var offset = callbackParameters->FetchData.RequiredFileOffset;
        var length = callbackParameters->FetchData.RequiredLength;
        _ = Task.Run(() => Hydrate(context, identity, connectionKey, transferKey, offset, length));
    }

    private static void Hydrate(ProviderContext context, string relativePath, CF_CONNECTION_KEY connectionKey, long transferKey, long offset, long length)
    {
        try
        {
            relativePath = NormalizeRelativePath(relativePath);
            if (relativePath.Length == 0) throw new InvalidOperationException("Missing placeholder identity.");
            var url = $"{context.ServerBase}/api/devices/agent/file?deviceId={Uri.EscapeDataString(context.DeviceId)}&syncRootId={Uri.EscapeDataString(context.SyncRootId)}&relPath={Uri.EscapeDataString(relativePath)}";
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(55) };
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("x-agent-token", context.AgentToken);
            if (length > 0) request.Headers.Range = new RangeHeaderValue(offset, offset + length - 1);
            using var response = client.Send(request, HttpCompletionOption.ResponseContentRead);
            response.EnsureSuccessStatusCode();
            var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            if (response.StatusCode != System.Net.HttpStatusCode.PartialContent && offset > 0)
            {
                if (offset >= bytes.LongLength) throw new InvalidOperationException("Server response is shorter than the requested file range.");
                bytes = bytes.AsSpan(checked((int)offset)).ToArray();
            }
            if (bytes.LongLength > length && length > 0) bytes = bytes.AsSpan(0, checked((int)length)).ToArray();
            TransferData(connectionKey, transferKey, offset, bytes, 0);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Hydration failed for {relativePath}: {ex.Message}");
            TransferData(connectionKey, transferKey, offset, Array.Empty<byte>(), unchecked((int)0xC000CF00), length);
        }
    }

    private static unsafe void TransferData(CF_CONNECTION_KEY connectionKey, long transferKey, long offset, byte[] bytes, int status, long? transferLength = null)
    {
        fixed (byte* buffer = bytes)
        {
            var info = new CF_OPERATION_INFO
            {
                StructSize = (uint)sizeof(CF_OPERATION_INFO),
                Type = CF_OPERATION_TYPE.CF_OPERATION_TYPE_TRANSFER_DATA,
                ConnectionKey = connectionKey,
                TransferKey = transferKey
            };
            var parameters = new CF_OPERATION_PARAMETERS { ParamSize = (uint)sizeof(CF_OPERATION_PARAMETERS) };
            parameters.TransferData.Flags = CF_OPERATION_TRANSFER_DATA_FLAGS.CF_OPERATION_TRANSFER_DATA_FLAG_NONE;
            parameters.TransferData.CompletionStatus = (NTSTATUS)status;
            parameters.TransferData.Buffer = bytes.Length == 0 ? null : buffer;
            parameters.TransferData.Offset = offset;
            parameters.TransferData.Length = transferLength ?? bytes.LongLength;
            var hr = PInvoke.CfExecute(in info, ref parameters);
            Marshal.ThrowExceptionForHR(hr);
        }
    }

    private static unsafe int SetPin(IReadOnlyDictionary<string, string> options, bool pinned)
    {
        var target = Path.GetFullPath(Required(options, "path"));
        using var handle = File.OpenHandle(target, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var hr = PInvoke.CfSetPinState(new HANDLE(handle.DangerousGetHandle()),
            pinned ? CF_PIN_STATE.CF_PIN_STATE_PINNED : CF_PIN_STATE.CF_PIN_STATE_UNPINNED,
            pinned ? CF_SET_PIN_FLAGS.CF_SET_PIN_FLAG_RECURSE : CF_SET_PIN_FLAGS.CF_SET_PIN_FLAG_RECURSE_ONLY,
            null);
        Marshal.ThrowExceptionForHR(hr);
        if (!pinned && File.Exists(target))
        {
            hr = PInvoke.CfDehydratePlaceholder(new HANDLE(handle.DangerousGetHandle()), 0, -1, CF_DEHYDRATE_FLAGS.CF_DEHYDRATE_FLAG_NONE, null);
            Marshal.ThrowExceptionForHR(hr);
        }
        return 0;
    }

    private static string UnprotectToken(string tokenFile)
    {
        var protectedBytes = Convert.FromBase64String(File.ReadAllText(tokenFile, Encoding.UTF8).Trim());
        var bytes = System.Security.Cryptography.ProtectedData.Unprotect(protectedBytes, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
        return Encoding.UTF8.GetString(bytes);
    }

    private static string NormalizeRelativePath(string value)
    {
        var normalized = value.Replace('\\', '/').Trim('/');
        if (normalized.Length == 0 || normalized.Split('/').Any(part => part is "" or "." or "..")) return "";
        return normalized;
    }

    private static void EnsureInside(string root, string candidate)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Manifest path escapes sync root.");
    }

    private static bool IsSameOrDescendant(string root, string candidate)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        var normalizedCandidate = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar);
        return string.Equals(normalizedCandidate, normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
               normalizedCandidate.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static int Unregister(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        var account = Required(options, "account");
        try
        {
            StorageProviderSyncRootManager.Unregister(SyncRootRegistrationId(account));
        }
        catch (COMException)
        {
            var hr = PInvoke.CfUnregisterSyncRoot(root);
            Marshal.ThrowExceptionForHR(hr);
        }
        RemoveExplorerRegistration(account);
        return 0;
    }

    private static int Open(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        Directory.CreateDirectory(root);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{root}\"") { UseShellExecute = true });
        return 0;
    }

    private static unsafe int MarkInSync(IReadOnlyDictionary<string, string> options)
    {
        var target = Path.GetFullPath(Required(options, "path"));
        using var handle = File.OpenHandle(target, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var state = options.GetValueOrDefault("state", "in-sync").Equals("not-in-sync", StringComparison.OrdinalIgnoreCase)
            ? CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_NOT_IN_SYNC
            : CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_IN_SYNC;
        var hr = PInvoke.CfSetInSyncState(new HANDLE(handle.DangerousGetHandle()), state, CF_SET_IN_SYNC_FLAGS.CF_SET_IN_SYNC_FLAG_NONE, null);
        Marshal.ThrowExceptionForHR(hr);
        return 0;
    }

    private static unsafe int SetStatus(IReadOnlyDictionary<string, string> options)
    {
        var root = Path.GetFullPath(Required(options, "root"));
        var account = Required(options, "account");
        var baseDisplayName = options.GetValueOrDefault("display-name", $"NAS Drive - {account}");
        var state = options.GetValueOrDefault("state", "up-to-date").ToLowerInvariant();
        var suffix = state switch
        {
            "connecting" => "연결 중",
            "syncing" => "동기화 중",
            "up-to-date" => "NAS와 동기화됨",
            "offline" => "NAS 오프라인",
            "paused" => "일시 중지",
            "needs-relink" => "재연결 필요",
            "updating" => "업데이트 중",
            _ => "오류"
        };
        try
        {
            using var handle = File.OpenHandle(root, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var inSyncState = state == "up-to-date"
                ? CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_IN_SYNC
                : CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_NOT_IN_SYNC;
            _ = PInvoke.CfSetInSyncState(new HANDLE(handle.DangerousGetHandle()), inSyncState, CF_SET_IN_SYNC_FLAGS.CF_SET_IN_SYNC_FLAG_NONE, null);
        }
        catch
        {
            // The namespace label and tray still provide a reliable status on older Windows builds.
        }

        SHChangeNotify(ShcneUpdateDir, ShcnfPathW, root, IntPtr.Zero);
        SHChangeNotify(ShcneAssocChanged, ShcnfIdList, null, IntPtr.Zero);
        try { ConfigureExplorerViewCore(root); } catch { }
        return 0;
    }

    private static string SyncRootRegistrationId(string account)
    {
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        return $"NASDrive!{sid}!{account.Replace('!', '_')}";
    }

    private static string RegistrationId(string account)
    {
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        var bytes = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes($"{sid}|{account}"));
        return new Guid(bytes.AsSpan(0, 16)).ToString("B");
    }

    private static void WriteExplorerRegistration(string root, string account, string displayName)
    {
        var clsid = RegistrationId(account);
        using var clsidKey = Microsoft.Win32.Registry.CurrentUser.CreateSubKey($@"Software\Classes\CLSID\{clsid}");
        clsidKey.SetValue(null, displayName);
        clsidKey.SetValue("System.IsPinnedToNameSpaceTree", 1, Microsoft.Win32.RegistryValueKind.DWord);
        clsidKey.SetValue("SortOrderIndex", 66, Microsoft.Win32.RegistryValueKind.DWord);
        using var iconKey = clsidKey.CreateSubKey("DefaultIcon");
        var installDir = Path.GetDirectoryName(Environment.ProcessPath) ?? string.Empty;
        var brandedIcon = Path.Combine(installDir, "nas-drive.ico");
        var iconSource = File.Exists(brandedIcon) ? brandedIcon : Environment.ProcessPath;
        iconKey.SetValue(null, $"{iconSource},0", Microsoft.Win32.RegistryValueKind.ExpandString);
        using var inProcServer = clsidKey.CreateSubKey("InProcServer32");
        inProcServer.SetValue(null, @"%SystemRoot%\System32\shell32.dll", Microsoft.Win32.RegistryValueKind.ExpandString);
        using var instanceKey = clsidKey.CreateSubKey("Instance");
        instanceKey.SetValue("CLSID", "{0E5AAE11-A475-4c5b-AB00-C66DE400274E}");
        using var bag = instanceKey.CreateSubKey("InitPropertyBag");
        bag.SetValue("Attributes", 0x11, Microsoft.Win32.RegistryValueKind.DWord);
        bag.SetValue("TargetFolderPath", root, Microsoft.Win32.RegistryValueKind.ExpandString);
        using var shellFolder = clsidKey.CreateSubKey("ShellFolder");
        shellFolder.SetValue("FolderValueFlags", 0x28, Microsoft.Win32.RegistryValueKind.DWord);
        shellFolder.SetValue("Attributes", unchecked((int)0xF080004D), Microsoft.Win32.RegistryValueKind.DWord);
        using var namespaceKey = Microsoft.Win32.Registry.CurrentUser.CreateSubKey($@"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\{clsid}");
        namespaceKey.SetValue(null, displayName);
        using var modernNamespaceKey = Microsoft.Win32.Registry.CurrentUser.CreateSubKey($@"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace_41040327\{clsid}");
        modernNamespaceKey.SetValue(null, displayName);
        using var hideKey = Microsoft.Win32.Registry.CurrentUser.CreateSubKey($@"Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel");
        hideKey.SetValue(clsid, 1, Microsoft.Win32.RegistryValueKind.DWord);
    }

    private static void RemoveExplorerRegistration(string account)
    {
        var clsid = RegistrationId(account);
        Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree($@"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\{clsid}", false);
        Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree($@"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace_41040327\{clsid}", false);
        Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\CLSID\{clsid}", false);
    }

    private static int Usage()
    {
        Console.Error.WriteLine("NAS-Drive-Provider register --root <path> --account <id> [--display-name <name>]");
        Console.Error.WriteLine("NAS-Drive-Provider unregister --root <path> --account <id>");
        Console.Error.WriteLine("NAS-Drive-Provider open --root <path>");
        Console.Error.WriteLine("NAS-Drive-Provider mark-in-sync --path <path> [--state in-sync|not-in-sync]");
        Console.Error.WriteLine("NAS-Drive-Provider set-status --root <path> --account <id> --display-name <name> --state <state>");
        Console.Error.WriteLine("NAS-Drive-Provider sync-placeholders --root <path> --manifest <json>");
        Console.Error.WriteLine("NAS-Drive-Provider serve --root <path> --server-base <url> --device-id <id> --sync-root-id <id> --token-file <path>");
        Console.Error.WriteLine("NAS-Drive-Provider self-test");
        Console.Error.WriteLine("NAS-Drive-Provider pin|free-space --path <path>");
        return 2;
    }
}
