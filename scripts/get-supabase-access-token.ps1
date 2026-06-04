# Reads Supabase CLI token from Windows Credential Manager (after `npx supabase login`).
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct NativeCredential {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint Attribute;
    public IntPtr TargetAlias;
    public IntPtr UserName;
}

public static class SupabaseCredRead {
    public const int CRED_TYPE_GENERIC = 1;
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credential);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CredFree(IntPtr cred);
}
"@

$target = 'Supabase CLI:supabase'
$ptr = [IntPtr]::Zero
if (-not [SupabaseCredRead]::CredRead($target, [SupabaseCredRead]::CRED_TYPE_GENERIC, 0, [ref]$ptr)) {
    Write-Error "Could not read credential '$target'. Run: npx supabase login"
    exit 1
}

try {
    $ncred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][NativeCredential])
    $size = [int]$ncred.CredentialBlobSize
    $bytes = New-Object byte[] $size
    [Runtime.InteropServices.Marshal]::Copy($ncred.CredentialBlob, $bytes, 0, $size)
    $utf16 = [System.Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
    $utf8 = [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    $token = if ($utf16 -match '^sbp_[A-Za-z0-9_-]+$') { $utf16 }
             elseif ($utf8 -match '^sbp_[A-Za-z0-9_-]+$') { $utf8 }
             elseif ($utf16 -match '^[A-Za-z0-9._-]{20,}$') { $utf16 }
             else { $utf8 }
    if (-not $token -or $token.Length -lt 20) {
        Write-Error 'Credential blob empty or unreadable'
        exit 1
    }
    $env:SUPABASE_ACCESS_TOKEN = $token
    Write-Host '[get-supabase-access-token] SUPABASE_ACCESS_TOKEN set (value hidden)'
}
finally {
    [void][SupabaseCredRead]::CredFree($ptr)
}
