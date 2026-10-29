# Disposable desktop runners only. Change the real display, never emulate DPI
# with coordinate multiplication, browser zoom, or an app compatibility override.
function Set-SmokeDisplay([ValidateSet(100, 125, 150, 200)][int]$ScalingPercent) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class KotobaSmokeDisplay {
    [StructLayout(LayoutKind.Sequential)]
    public struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Source { public Luid Adapter; public uint Id, Mode, Flags; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Target {
        public Luid Adapter;
        public uint Id, Mode, Technology, Rotation, Scaling, RefreshNumerator, RefreshDenominator;
        public uint Scanline, Available, Flags;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Path { public Source Source; public Target Target; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Header { public int Type; public uint Size; public Luid Adapter; public uint Id; }
    [StructLayout(LayoutKind.Sequential)]
    public struct ScaleGet { public Header Header; public int Minimum, Current, Maximum; }
    [StructLayout(LayoutKind.Sequential)]
    public struct ScaleSet { public Header Header; public int Relative; }
    [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint paths,
        [Out] Path[] pathArray, ref uint modes, IntPtr modeArray, IntPtr topology);
    // Windows per-source DPI packets. These negative packet types are not a
    // public compatibility contract: unsupported runners must fail, not skip.
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref ScaleGet packet);
    [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref ScaleSet packet);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(
        string device, int mode, IntPtr settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(
        string device, IntPtr settings, IntPtr hwnd, uint flags, IntPtr param);
    static void Check(int result, string operation) {
        if (result != 0) throw new InvalidOperationException(operation + " failed (" + result + ").");
    }
    public static string Modes() {
        var sizes = new HashSet<string>();
        IntPtr settings = Marshal.AllocHGlobal(220);
        try {
            for (int i = 0; i < 220; i++) Marshal.WriteByte(settings, i, 0);
            Marshal.WriteInt16(settings, 68, 220);
            for (int mode = 0; EnumDisplaySettings(null, mode, settings); mode++)
                sizes.Add(Marshal.ReadInt32(settings, 172) + "x" + Marshal.ReadInt32(settings, 176));
            return String.Join(", ", sizes);
        } finally { Marshal.FreeHGlobal(settings); }
    }
    public static string Configure(int percent) {
        // Room for every overlay target/endpoint at 200%. The main window may
        // exceed the work area's height at its 620-logical-pixel minimum; its
        // controls use UI Automation, while overlay manipulation is real mouse.
        IntPtr settings = Marshal.AllocHGlobal(220); // DEVMODEW
        try {
            for (int i = 0; i < 220; i++) Marshal.WriteByte(settings, i, 0);
            Marshal.WriteInt16(settings, 68, 220);
            if (!EnumDisplaySettings(null, -1, settings)) throw new InvalidOperationException("Cannot read display mode.");
            Marshal.WriteInt32(settings, 72, 0x00080000 | 0x00100000); // DM_PELSWIDTH | DM_PELSHEIGHT
            Marshal.WriteInt32(settings, 172, 1920);
            Marshal.WriteInt32(settings, 176, 1200);
            Check(ChangeDisplaySettingsEx(null, settings, IntPtr.Zero, 0, IntPtr.Zero), "Set 1920x1200 desktop");
            if (!EnumDisplaySettings(null, -1, settings)) throw new InvalidOperationException("Cannot verify display mode.");
            if (Marshal.ReadInt32(settings, 172) != 1920 || Marshal.ReadInt32(settings, 176) != 1200)
                throw new InvalidOperationException("Desktop resolution did not take effect.");
        } finally { Marshal.FreeHGlobal(settings); }
        uint paths, modes;
        Check(GetDisplayConfigBufferSizes(2, out paths, out modes), "Read active display count");
        var active = new Path[paths];
        IntPtr modeBuffer = Marshal.AllocHGlobal(checked((int)modes * 64));
        try {
            Check(QueryDisplayConfig(2, ref paths, active, ref modes, modeBuffer, IntPtr.Zero), "Read active display paths");
            if (paths != 1) throw new InvalidOperationException("Smoke requires exactly one active display.");
            var get = new ScaleGet { Header = new Header {
                Type = -3, Size = (uint)Marshal.SizeOf(typeof(ScaleGet)),
                Adapter = active[0].Source.Adapter, Id = active[0].Source.Id
            }};
            Check(DisplayConfigGetDeviceInfo(ref get), "Read per-display DPI scaling");
            int[] percentages = { 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500 };
            // Offsets are relative to the display's recommended scale; minimum
            // is the (negative) offset of 100%, not necessarily zero.
            int relative = Array.IndexOf(percentages, percent) + get.Minimum;
            if (relative < get.Minimum || relative > get.Maximum)
                throw new InvalidOperationException("Requested scaling is unsupported by this display: min=" +
                    get.Minimum + "; current=" + get.Current + "; max=" + get.Maximum + "; requested=" + relative);
            var set = new ScaleSet { Header = get.Header, Relative = relative };
            set.Header.Type = -4;
            set.Header.Size = (uint)Marshal.SizeOf(typeof(ScaleSet));
            Check(DisplayConfigSetDeviceInfo(ref set), "Set per-display DPI scaling");
            Check(DisplayConfigGetDeviceInfo(ref get), "Verify per-display DPI scaling");
            if (get.Current != relative) throw new InvalidOperationException("Requested scaling did not take effect.");
            return "1920x1200; requested=" + percent + "%; relative=" + relative;
        } finally { Marshal.FreeHGlobal(modeBuffer); }
    }
}
'@
    Write-Host ("Supported desktop modes: " + [KotobaSmokeDisplay]::Modes())
    $configuration = [KotobaSmokeDisplay]::Configure($ScalingPercent)
    Start-Sleep -Seconds 3
    return $configuration
}
