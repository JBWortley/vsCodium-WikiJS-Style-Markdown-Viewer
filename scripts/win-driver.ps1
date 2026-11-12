# Live-test driver for one VSCodium window, found by process id and title fragment.
#   -Action screenshot -Out file.png      capture the window (PrintWindow, works when covered)
#   -Action rect                          print the window rectangle (physical pixels)
#   -Action keys -Keys "^+v"              focus the window and send SendKeys input ("|" = pause)
#   -Action alttap                        focus the window and tap Alt (as a user would)
#   -Action move -FX 0.6 -FY 0.5          real mouse move to a point inside the window (fractions)
#   -Action click -X 812 -Y 455           real left click at physical screen pixels
# Mouse input is refused unless the target pixel belongs to the test window, so a click can never
# land on another application.
param(
  [Parameter(Mandatory = $true)][ValidateSet("screenshot", "keys", "alttap", "rect", "move", "click")][string]$Action,
  [Parameter(Mandatory = $true)][int]$ProcessRoot,
  [string]$TitleLike = "Extension Development Host",
  [string]$Out,
  [string]$Keys,
  [double]$FX = 0.5,
  [double]$FY = 0.5,
  [int]$X = -1,
  [int]$Y = -1
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static List<IntPtr> Windows(HashSet<uint> pids, string like) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!IsWindowVisible(h) || !pids.Contains(pid)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(like)) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# Physical pixels everywhere (window rects, cursor positions), whatever the display scaling.
# Per-monitor v2 awareness: rectangles and cursor positions are real pixels on every monitor,
# even with mixed scaling (-4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).
try { if (-not [W]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) { [void][W]::SetProcessDPIAware() } } catch { [void][W]::SetProcessDPIAware() }

# VSCodium's window belongs to a child of the launched process: collect the whole process tree.
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$tree = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$tree.Add([uint32]$ProcessRoot)
do {
  $added = $false
  foreach ($p in $all) { if ($tree.Contains([uint32]$p.ParentProcessId) -and $tree.Add([uint32]$p.ProcessId)) { $added = $true } }
} while ($added)

$hwnd = [W]::Windows($tree, $TitleLike) | Select-Object -First 1
if (-not $hwnd) { throw "No visible window titled '*$TitleLike*' under process $ProcessRoot" }
$r = New-Object W+RECT
[void][W]::GetWindowRect($hwnd, [ref]$r)
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top

function Focus-TestWindow {
  # Windows restricts which process may take the foreground. Try, in order: borrowing the
  # foreground thread's input queue, a minimize/restore cycle (always grants foreground), and
  # WScript AppActivate. No synthetic Alt here: it would open VSCodium's menu bar.
  $shell = New-Object -ComObject WScript.Shell
  $winPid = 0; [void][W]::GetWindowThreadProcessId($hwnd, [ref]$winPid)
  for ($attempt = 1; $attempt -le 4 -and [W]::GetForegroundWindow() -ne $hwnd; $attempt++) {
    switch ($attempt) {
      1 {
        $fg = [W]::GetForegroundWindow(); $fgPid = 0
        $fgThread = [W]::GetWindowThreadProcessId($fg, [ref]$fgPid)
        $me = [W]::GetCurrentThreadId()
        [void][W]::AttachThreadInput($me, $fgThread, $true)
        [void][W]::BringWindowToTop($hwnd)
        [void][W]::SetForegroundWindow($hwnd)
        [void][W]::AttachThreadInput($me, $fgThread, $false)
      }
      2 { [void][W]::ShowWindow($hwnd, 6); Start-Sleep -Milliseconds 300; [void][W]::ShowWindow($hwnd, 9) }   # minimize, restore
      default { [void]$shell.AppActivate([int]$winPid) }
    }
    Start-Sleep -Milliseconds 500
  }
  if ([W]::GetForegroundWindow() -ne $hwnd) { throw "Could not focus the test window after 4 attempts" }
}

function Assert-PointOnTestWindow([int]$px, [int]$py) {
  if ($px -lt $r.Left -or $px -ge $r.Right -or $py -lt $r.Top -or $py -ge $r.Bottom) { throw "Point $px,$py is outside the test window" }
  $pt = New-Object W+POINT; $pt.X = $px; $pt.Y = $py
  $top = [W]::GetAncestor([W]::WindowFromPoint($pt), 2)    # GA_ROOT
  if ($top -ne $hwnd) { throw "Point $px,$py is covered by another window; refusing to click" }
}

switch ($Action) {
  "rect" { "$($r.Left),$($r.Top),$w,$h" }
  "screenshot" {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [W]::PrintWindow($hwnd, $hdc, 2)   # PW_RENDERFULLCONTENT for Chromium/Electron
    $g.ReleaseHdc($hdc); $g.Dispose()
    if (-not $ok) { throw "PrintWindow failed" }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    "saved $Out ($w x $h)"
  }
  "keys" {
    Focus-TestWindow
    foreach ($chunk in $Keys -split '\|') {
      # Re-check before every chunk: if anything else took the foreground (e.g. the user clicked
      # another window), stop rather than type into it.
      if ([W]::GetForegroundWindow() -ne $hwnd) { throw "Lost focus to another window before sending '$chunk'; nothing more was typed" }
      [System.Windows.Forms.SendKeys]::SendWait($chunk)
      Start-Sleep -Milliseconds 250
    }
    "sent $Keys"
  }
  "alttap" {
    Focus-TestWindow
    [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    "tapped Alt"
  }
  "move" {
    Focus-TestWindow
    $px = [int]($r.Left + $w * $FX); $py = [int]($r.Top + $h * $FY)
    Assert-PointOnTestWindow $px $py
    # Two steps so the page sees a genuine mousemove inside it.
    [void][W]::SetCursorPos($px - 3, $py - 3); Start-Sleep -Milliseconds 80
    [void][W]::SetCursorPos($px, $py); Start-Sleep -Milliseconds 120
    "moved to $px,$py"
  }
  "click" {
    Focus-TestWindow
    if ($X -lt 0 -or $Y -lt 0) { $X = [int]($r.Left + $w * $FX); $Y = [int]($r.Top + $h * $FY) }
    Assert-PointOnTestWindow $X $Y
    [void][W]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 120
    [W]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN
    Start-Sleep -Milliseconds 60
    [W]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
    "clicked $X,$Y"
  }
}
