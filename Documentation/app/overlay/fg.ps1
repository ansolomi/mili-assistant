# Prints the foreground window's visible frame once per 400 ms: left,top,right,bottom,maximized,pid,class
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
while ($true) {
  $h = [W]::GetForegroundWindow()
  $r = New-Object W+RECT
  if ($h -ne [IntPtr]::Zero -and [W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -eq 0) {
    $sb = New-Object Text.StringBuilder 64; [void][W]::GetClassName($h, $sb, 64)
    $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
    "$($r.L),$($r.T),$($r.R),$($r.B),$([int][W]::IsZoomed($h)),$p,$($sb.ToString())"
  } else { "none" }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 400
}
