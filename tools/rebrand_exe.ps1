# Gives the game's executable the GoofyTrack identity: its icon (Explorer, shortcuts) and its name and version
# (Task Manager, file properties). Called by setup.js; Windows only, no download needed.
#
#   powershell -ExecutionPolicy Bypass -File tools\rebrand_exe.ps1 <exe> <icon.ico> <name> <version>
param([string]$Exe, [string]$Icon, [string]$Name, [string]$Version)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class Rebrand {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  delegate bool EnumNames(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLangs(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNames callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangs callback, IntPtr param);

  const int RT_ICON = 3, RT_GROUP_ICON = 14, RT_VERSION = 16;
  const ushort EN_US = 1033;

  // The (numeric id, language) of every resource of a type, so the old ones can be removed
  static List<KeyValuePair<int, ushort>> Existing(string exe, int type) {
    var found = new List<KeyValuePair<int, ushort>>();
    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 0x22);   // LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE
    if (module == IntPtr.Zero) throw new Win32Exception();
    try {
      EnumResourceNames(module, (IntPtr)type, (m, t, n, p) => {
        if ((long)n >> 16 != 0) return true;   // named (not numeric) resource: Electron has none of these
        EnumResourceLanguages(m, t, n, (m2, t2, n2, lang, p2) => { found.Add(new KeyValuePair<int, ushort>((int)n2, lang)); return true; }, IntPtr.Zero);
        return true;
      }, IntPtr.Zero);
    } finally { FreeLibrary(module); }
    return found;
  }

  static void Pad(MemoryStream s) { while (s.Length % 4 != 0) s.WriteByte(0); }

  // One block of a VS_VERSIONINFO tree: length, value length, type, key, value, children
  static byte[] Block(string key, int type, byte[] value, int valueLength, params byte[][] children) {
    var s = new MemoryStream();
    var w = new BinaryWriter(s);
    w.Write((ushort)0); w.Write((ushort)valueLength); w.Write((ushort)type);
    w.Write(Encoding.Unicode.GetBytes(key + "\0"));
    Pad(s);
    if (value != null) w.Write(value);
    foreach (var child in children) { Pad(s); w.Write(child); }
    var bytes = s.ToArray();
    bytes[0] = (byte)bytes.Length; bytes[1] = (byte)(bytes.Length >> 8);
    return bytes;
  }

  static byte[] Text(string key, string value) { return Block(key, 1, Encoding.Unicode.GetBytes(value + "\0"), value.Length + 1); }

  static byte[] VersionInfo(string name, string exeName, string version) {
    var parts = new ushort[4];
    var given = version.Split('.');
    for (int i = 0; i < 4 && i < given.Length; i++) ushort.TryParse(given[i], out parts[i]);
    var full = string.Join(".", Array.ConvertAll(parts, p => p.ToString()));
    var s = new MemoryStream();
    var w = new BinaryWriter(s);
    w.Write(0xFEEF04BDu); w.Write(0x00010000u);   // VS_FIXEDFILEINFO signature and structure version
    for (int i = 0; i < 2; i++) { w.Write((uint)(parts[0] << 16 | parts[1])); w.Write((uint)(parts[2] << 16 | parts[3])); }   // file, product version
    w.Write(0x3Fu); w.Write(0u); w.Write(0x40004u); w.Write(1u); w.Write(0u); w.Write(0u); w.Write(0u);   // flags mask, flags, Windows NT, application, subtype, date
    var strings = Block("StringFileInfo", 1, null, 0, Block("040904b0", 1, null, 0,
      Text("CompanyName", name), Text("FileDescription", name), Text("FileVersion", full), Text("InternalName", exeName),
      Text("LegalCopyright", "PolyTrack (c) Kodub - " + name + " mod"), Text("OriginalFilename", exeName),
      Text("ProductName", name), Text("ProductVersion", full)));
    var translation = Block("VarFileInfo", 1, null, 0, Block("Translation", 0, new byte[] { 0x09, 0x04, 0xb0, 0x04 }, 4));
    return Block("VS_VERSION_INFO", 0, s.ToArray(), 52, strings, translation);
  }

  public static void Apply(string exe, string icon, string name, string version) {
    var ico = File.ReadAllBytes(icon);
    int count = BitConverter.ToUInt16(ico, 4);
    var oldIcons = Existing(exe, RT_ICON);
    var oldGroups = Existing(exe, RT_GROUP_ICON);
    var oldVersions = Existing(exe, RT_VERSION);

    IntPtr update = BeginUpdateResource(exe, false);
    if (update == IntPtr.Zero) throw new Win32Exception();
    bool ok = false;
    try {
      foreach (var r in oldIcons) Check(UpdateResource(update, (IntPtr)RT_ICON, (IntPtr)r.Key, r.Value, null, 0));
      foreach (var r in oldVersions) Check(UpdateResource(update, (IntPtr)RT_VERSION, (IntPtr)r.Key, r.Value, null, 0));
      // The group keeps the id the exe already uses for its main icon (1 in Electron)
      int groupId = oldGroups.Count > 0 ? oldGroups[0].Key : 1;
      foreach (var r in oldGroups) Check(UpdateResource(update, (IntPtr)RT_GROUP_ICON, (IntPtr)r.Key, r.Value, null, 0));

      // .ico: 6-byte header, then 16 bytes per image (size, colours, planes, bits, byte count, offset);
      // the group resource repeats them in 14 bytes, the offset replaced by the id of an RT_ICON resource
      var group = new MemoryStream();
      group.Write(ico, 0, 6);
      for (int i = 0; i < count; i++) {
        int entry = 6 + 16 * i;
        int size = BitConverter.ToInt32(ico, entry + 8), offset = BitConverter.ToInt32(ico, entry + 12);
        var image = new byte[size];
        Array.Copy(ico, offset, image, 0, size);
        Check(UpdateResource(update, (IntPtr)RT_ICON, (IntPtr)(i + 1), EN_US, image, (uint)size));
        group.Write(ico, entry, 12);
        group.Write(BitConverter.GetBytes((ushort)(i + 1)), 0, 2);
      }
      var groupBytes = group.ToArray();
      Check(UpdateResource(update, (IntPtr)RT_GROUP_ICON, (IntPtr)groupId, EN_US, groupBytes, (uint)groupBytes.Length));

      var info = VersionInfo(name, Path.GetFileName(exe), version);
      Check(UpdateResource(update, (IntPtr)RT_VERSION, (IntPtr)1, EN_US, info, (uint)info.Length));
      ok = true;
    } finally {
      if (!EndUpdateResource(update, !ok) && ok) throw new Win32Exception();
    }
  }

  static void Check(bool ok) { if (!ok) throw new Win32Exception(); }
}
'@

[Rebrand]::Apply((Resolve-Path $Exe).Path, (Resolve-Path $Icon).Path, $Name, $Version)
