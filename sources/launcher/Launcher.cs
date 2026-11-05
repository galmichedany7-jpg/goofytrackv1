// "GoofyTrack Launcher.exe": installs, updates, rebuilds and starts GoofyTrack from one window. It only drives the
// Node scripts of sources/ (update.js, build.js), whose output it shows. Compiled by build_launcher.js with the C#
// compiler that ships with Windows (.NET Framework 4), so C# 5: no string interpolation, no ?. operator.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("GoofyTrack Launcher")]
[assembly: System.Reflection.AssemblyProduct("GoofyTrack")]

class Launcher : Form {
  static readonly Color Back = Color.FromArgb(18, 20, 28), Panel = Color.FromArgb(30, 33, 45), Accent = Color.FromArgb(255, 72, 64), Muted = Color.FromArgb(150, 156, 175);

  readonly string root = Path.GetDirectoryName(Application.ExecutablePath);
  readonly Label versionLabel, stateLabel;
  readonly Button mainButton, playButton, rebuildButton;
  readonly TextBox log;
  Dictionary<string, object> status;
  bool busy;

  [STAThread]
  static void Main() {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new Launcher());
  }

  Launcher() {
    Text = "GoofyTrack";
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
    ClientSize = new Size(640, 460);
    MinimumSize = new Size(520, 380);
    StartPosition = FormStartPosition.CenterScreen;
    BackColor = Back;
    ForeColor = Color.White;
    Font = new Font("Segoe UI", 10f);

    var title = new Label { Text = "GoofyTrack", Font = new Font("Segoe UI Semibold", 22f), AutoSize = true, Location = new Point(20, 14) };
    versionLabel = new Label { Text = "Vérification…", ForeColor = Muted, AutoSize = true, Location = new Point(23, 60) };
    stateLabel = new Label { Text = "", AutoSize = true, Location = new Point(23, 84) };

    mainButton = MakeButton("Installer", true);
    mainButton.Location = new Point(20, 118);
    mainButton.Width = 230;
    mainButton.Click += delegate { MainAction(); };
    playButton = MakeButton("Jouer", false);
    playButton.Location = new Point(260, 118);
    playButton.Click += delegate { Play(); };
    rebuildButton = MakeButton("Reconstruire", false);
    rebuildButton.Location = new Point(400, 118);
    rebuildButton.Click += delegate { Rebuild(); };

    log = new TextBox {
      Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, WordWrap = true,
      BackColor = Panel, ForeColor = Color.FromArgb(215, 218, 228), BorderStyle = BorderStyle.None,
      Font = new Font("Consolas", 9f), Location = new Point(20, 172),
      Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
    };
    log.Size = new Size(ClientSize.Width - 40, ClientSize.Height - 192);

    Controls.AddRange(new Control[] { title, versionLabel, stateLabel, mainButton, playButton, rebuildButton, log });
    Shown += delegate { Start(); };
  }

  static Button MakeButton(string text, bool primary) {
    var b = new Button { Text = text, Height = 40, Width = 130, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand, Enabled = false };
    b.FlatAppearance.BorderSize = primary ? 0 : 1;
    b.FlatAppearance.BorderColor = Muted;
    b.BackColor = primary ? Accent : Back;
    b.ForeColor = Color.White;
    b.Font = new Font("Segoe UI Semibold", 10.5f);
    return b;
  }

  string Exe { get { return Path.Combine(root, "GoofyTrack.exe"); } }

  void Start() {
    // what an update left behind (update.js renames this exe before copying the new one over it)
    try { File.Delete(Application.ExecutablePath + ".old"); } catch { }
    if (!File.Exists(Path.Combine(root, "sources", "update.js"))) {
      Fail("Le lanceur doit rester dans le dossier GoofyTrack, à côté du dossier sources.");
      return;
    }
    if (!HasNode()) {
      Fail("Node.js est introuvable : installez-le depuis https://nodejs.org puis rouvrez le lanceur.");
      if (MessageBox.Show(this, "GoofyTrack a besoin de Node.js (version 18 ou plus récente) pour s'installer et se mettre à jour.\n\nOuvrir nodejs.org ?", "GoofyTrack", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
        Process.Start("https://nodejs.org");
      return;
    }
    Refresh(null);
  }

  void Fail(string message) {
    versionLabel.Text = "";
    stateLabel.ForeColor = Accent;
    stateLabel.Text = message;
    Log(message);
  }

  static bool HasNode() {
    try {
      var p = Process.Start(new ProcessStartInfo("node", "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
      p.WaitForExit(10000);
      return p.ExitCode == 0;
    } catch { return false; }
  }

  // Asks update.js where things stand, then sets the buttons
  void Refresh(Action then) {
    SetBusy(true, "Recherche de mises à jour…");
    var output = new StringBuilder();
    RunNode(new[] { "sources\\update.js", "--status" }, line => output.AppendLine(line), false, code => {
      try {
        var lines = output.ToString().Trim().Split('\n');
        status = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(lines[lines.Length - 1]);
      } catch {
        status = null;
        Log(output.ToString());
      }
      SetBusy(false, null);
      ShowStatus();
      if (then != null) then();
    });
  }

  string S(string key) { object v; return status != null && status.TryGetValue(key, out v) && v != null ? v.ToString() : null; }
  bool B(string key) { object v; return status != null && status.TryGetValue(key, out v) && v is bool && (bool)v; }

  void ShowStatus() {
    if (status == null) { Fail("Impossible de lire l'état de GoofyTrack (voir le journal)."); return; }
    bool hasGame = B("hasGame"), update = B("updateAvailable");
    string installed = S("installed"), source = S("source"), latest = S("latest"), error = S("error");

    versionLabel.Text = (hasGame && installed != null ? "Version installée : " + installed : "Jeu pas encore installé")
      + "     Dernière version : " + (latest ?? "inconnue");
    stateLabel.ForeColor = Color.White;
    if (error != null) { stateLabel.ForeColor = Accent; stateLabel.Text = "Impossible de vérifier les mises à jour : " + error; }
    else if (!hasGame) stateLabel.Text = "Installez le jeu : il se télécharge tout seul (environ 150 Mo, une seule fois).";
    else if (update) stateLabel.Text = "Une nouvelle version est disponible.";
    else if (installed != source) stateLabel.Text = "Le jeu n'a pas encore la version " + source + " du code : reconstruisez-le.";
    else stateLabel.Text = "GoofyTrack est à jour.";

    if (!hasGame) { mainButton.Text = "Installer"; mainButton.Enabled = true; }
    else if (update) { mainButton.Text = "Mettre à jour" + (B("git") ? "" : " vers la " + latest); mainButton.Enabled = true; }
    else { mainButton.Text = "À jour"; mainButton.Enabled = false; }
    mainButton.BackColor = mainButton.Enabled ? Accent : Panel;
    playButton.Enabled = hasGame;
    rebuildButton.Enabled = hasGame;
  }

  void MainAction() {
    if (B("hasGame")) { if (GameClosed()) RunUpdate(new string[0]); return; }
    // a PolyTrack install next to the folder is copied (no download); none: the game is downloaded (polytrack.js)
    string folder = S("polyTrack");
    if (folder != null) Log("PolyTrack : " + folder);
    RunUpdate(folder != null ? new[] { folder } : new string[0]);
  }

  void RunUpdate(string[] extra) {
    var args = new List<string> { "sources\\update.js" };
    args.AddRange(extra);
    RunStep(args.ToArray(), "Mise à jour…");
  }

  void Rebuild() {
    if (GameClosed()) RunStep(new[] { "sources\\build.js" }, "Construction du jeu…");
  }

  void RunStep(string[] args, string label) {
    SetBusy(true, label);
    log.Clear();
    RunNode(args, Log, true, code => {
      Log(code == 0 ? "\r\nTerminé." : "\r\nÉchec (code " + code + ").");
      Refresh(null);
    });
  }

  bool GameClosed() {
    while (Process.GetProcessesByName("GoofyTrack").Length > 0)
      if (MessageBox.Show(this, "GoofyTrack est ouvert : fermez le jeu puis cliquez sur Réessayer.", "GoofyTrack", MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning) != DialogResult.Retry) return false;
    return true;
  }

  void Play() {
    if (!File.Exists(Exe)) return;
    Process.Start(new ProcessStartInfo(Exe) { WorkingDirectory = root, UseShellExecute = true });
    Close();
  }

  void SetBusy(bool on, string label) {
    busy = on;
    UseWaitCursor = on;
    if (on) {
      mainButton.Enabled = playButton.Enabled = rebuildButton.Enabled = false;
      mainButton.BackColor = Panel;
      stateLabel.ForeColor = Color.White;
      stateLabel.Text = label;
    }
  }

  void Log(string line) {
    if (InvokeRequired) { BeginInvoke(new Action<string>(Log), line); return; }
    log.AppendText(line.Replace("\r", "").Replace("\n", "\r\n") + "\r\n");
  }

  // Runs node in the GoofyTrack folder, handing each line of its output to onLine, then the exit code to done
  // (both on the window's thread)
  void RunNode(string[] args, Action<string> onLine, bool showErrors, Action<int> done) {
    var quoted = new StringBuilder();
    foreach (var a in args) quoted.Append(quoted.Length > 0 ? " " : "").Append('"').Append(a.TrimEnd('\\')).Append('"');
    var info = new ProcessStartInfo("node", quoted.ToString()) {
      WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
      RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false),
    };
    info.EnvironmentVariables["NO_COLOR"] = "1";
    var thread = new Thread(() => {
      int code;
      try {
        using (var p = Process.Start(info)) {
          p.OutputDataReceived += (s, e) => { if (e.Data != null) Ui(() => onLine(e.Data)); };
          p.ErrorDataReceived += (s, e) => { if (e.Data != null && (showErrors || e.Data.Trim().Length > 0)) Ui(() => Log(e.Data)); };
          p.BeginOutputReadLine();
          p.BeginErrorReadLine();
          p.WaitForExit();
          code = p.ExitCode;
        }
      } catch (Exception e) {
        Ui(() => Log("Impossible de lancer Node.js : " + e.Message));
        code = -1;
      }
      Ui(() => done(code));
    });
    thread.IsBackground = true;
    thread.Start();
  }

  void Ui(Action a) { if (!IsDisposed) BeginInvoke(a); }

  protected override void OnFormClosing(FormClosingEventArgs e) {
    if (busy && e.CloseReason == CloseReason.UserClosing &&
        MessageBox.Show(this, "Une installation est en cours. Quitter quand même ?", "GoofyTrack", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
      e.Cancel = true;
    base.OnFormClosing(e);
  }
}
