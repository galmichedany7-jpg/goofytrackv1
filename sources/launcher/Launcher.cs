// "GoofyTrack Launcher.exe": installs, updates, rebuilds and starts GoofyTrack from one window. It only drives the
// Node scripts of sources/ (update.js, build.js), whose output it shows. Compiled by build_launcher.js with the C#
// compiler that ships with Windows (.NET Framework 4), so C# 5: no string interpolation, no ?. operator.
//
// The window (2.26) is drawn by itself, like a game's title screen: a GoofyTrack scene (launcher_bg.jpg, Monaco GP)
// darkened on the left, the logo at the top left (launcher_logo.png, goofytrack-logo.svg drawn as a PNG), the
// actions at the bottom left ("Mettre à jour le jeu", "Reconstruire le jeu", then "Jouer à GoofyTrack"), the versions
// at the bottom right, and the log on the right while a step runs or when asked for. build_launcher.js builds both
// images into the exe.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("GoofyTrack Launcher")]
[assembly: System.Reflection.AssemblyProduct("GoofyTrack")]

class Launcher : Form {
  static readonly Color Ink = Color.FromArgb(8, 9, 13), Accent = Color.FromArgb(242, 13, 22), AccentHot = Color.FromArgb(255, 52, 60),
    Muted = Color.FromArgb(190, 195, 210), Bad = Color.FromArgb(255, 105, 105), LogBack = Color.FromArgb(16, 18, 25);

  // one of the actions at the bottom left: a row, or the Play button (Primary)
  class Item {
    public string Text, Hint;
    public bool Enabled, Primary, Dot;
    public Action Run;
    public Rectangle Box;
  }

  readonly string root = Path.GetDirectoryName(Application.ExecutablePath);
  readonly float scale;          // the screen's scale: 1 at 96 dpi
  readonly Image background, logo;
  Bitmap scene;                  // the background, its shades and the logo at the window's size
  RectangleF logoBox;            // where the logo goes (Arrange)
  int logoBottom;
  readonly Item updateItem, rebuildItem, playItem;
  readonly Item[] items;
  Item hovered;
  Rectangle logToggle;
  bool toggleHot;
  readonly Panel logPanel;
  readonly TextBox log;
  bool logShown;
  string stateText = "Vérification…", versionText = "";
  bool stateError;
  readonly System.Windows.Forms.Timer spinner;
  int spin;
  readonly Font rowFont, hintFont, playFont, stateFont, smallFont;
  Dictionary<string, object> status;
  bool busy;

  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  [STAThread]
  static void Main() {
    try { if (Environment.OSVersion.Version.Major >= 6) SetProcessDPIAware(); } catch { }   // sharp on scaled screens
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new Launcher());
  }

  int P(float v) { return (int)Math.Round(v * scale); }

  Launcher() {
    Text = "GoofyTrack Launcher";
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
    using (var g = CreateGraphics()) scale = g.DpiX / 96f;
    SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
    BackColor = Ink;
    ForeColor = Color.White;
    Font = new Font("Segoe UI", 10f);
    rowFont = new Font("Segoe UI Semibold", 14f);
    hintFont = new Font("Segoe UI", 9.5f);
    playFont = new Font("Segoe UI", 15f, FontStyle.Bold);
    stateFont = new Font("Segoe UI Semibold", 11.5f);
    smallFont = new Font("Segoe UI", 9f);
    background = Resource("launcher_bg.jpg");
    logo = Resource("launcher_logo.png");

    updateItem = new Item { Text = "Mettre à jour le jeu" };
    updateItem.Run = MainAction;
    rebuildItem = new Item { Text = "Reconstruire le jeu", Hint = "Refait le jeu à partir du code" };
    rebuildItem.Run = Rebuild;
    playItem = new Item { Text = "Jouer à GoofyTrack", Primary = true };
    playItem.Run = Play;
    items = new[] { updateItem, rebuildItem, playItem };

    log = new TextBox {
      Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, WordWrap = true,
      BackColor = LogBack, ForeColor = Color.FromArgb(215, 218, 228), BorderStyle = BorderStyle.None,
      Font = new Font("Consolas", 9f), Dock = DockStyle.Fill,
    };
    logPanel = new Panel { BackColor = LogBack, Padding = new Padding(P(14)), Visible = false };
    logPanel.Controls.Add(log);
    Controls.Add(logPanel);

    spinner = new System.Windows.Forms.Timer { Interval = 30 };
    spinner.Tick += delegate { spin++; Invalidate(BarBox()); };

    ClientSize = new Size(P(1040), P(585));
    MinimumSize = SizeFromClientSize(new Size(P(860), P(484)));
    StartPosition = FormStartPosition.CenterScreen;
    Arrange();
    Shown += delegate { Start(); };
  }

  // an image built into the exe (build_launcher.js), copied so that its stream can be closed
  static Image Resource(string name) {
    try {
      using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
        if (stream == null) return null;
        using (var image = Image.FromStream(stream)) return new Bitmap(image);
      }
    } catch { return null; }
  }

  // ---------------------------------------------------------------- layout and drawing

  int Margin44 { get { return P(44); } }
  int BarWidth { get { return Math.Min(P(470), (int)(ClientSize.Width * 0.46)); } }

  // where the actions and the log go, for the window's size
  void Arrange() {
    if (items == null || ClientSize.Width <= 0 || ClientSize.Height <= 0) return;
    int w = ClientSize.Width, h = ClientSize.Height, m = Margin44, bar = BarWidth, row = P(52);
    playItem.Box = new Rectangle(m, h - m - P(58), bar - m, P(58));
    rebuildItem.Box = new Rectangle(0, playItem.Box.Top - P(28) - row, bar, row);
    updateItem.Box = new Rectangle(0, rebuildItem.Box.Top - P(8) - row, bar, row);
    float lw = Math.Min(P(560), w * 0.52f);
    logoBox = new RectangleF(m - P(10), P(28), lw, logo != null ? lw * logo.Height / logo.Width : P(72));
    logoBottom = (int)logoBox.Bottom;
    // the log: right of the actions, under the logo and the state line
    int left = bar + P(40), top = BarBox().Bottom + P(24);
    logPanel.Bounds = new Rectangle(left, top, w - left - m, h - top - P(84));
  }

  protected override void OnResize(EventArgs e) {
    base.OnResize(e);
    Arrange();
  }

  // the background, as large as the window and the car right of the middle, its shades, and the logo
  void BuildScene() {
    int w = ClientSize.Width, h = ClientSize.Height;
    if (scene != null) scene.Dispose();
    scene = new Bitmap(w, h);
    using (var g = Graphics.FromImage(scene)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.Clear(Ink);
      if (background != null) {
        float k = 1.3f * Math.Max((float)w / background.Width, (float)h / background.Height);
        float bw = background.Width * k, bh = background.Height * k;
        float x = Math.Min(0f, Math.Max(w - bw, 0.6f * w - bw / 2)), y = h - bh;
        g.DrawImage(background, x, y, bw, bh);
      }
      using (var b = new SolidBrush(Color.FromArgb(45, Ink))) g.FillRectangle(b, 0, 0, w, h);
      Shade(g, new Rectangle(0, 0, (int)(w * 0.78), h), 0f, new[] { 230, 170, 0 }, new[] { 0f, 0.45f, 1f });
      Shade(g, new Rectangle(0, h / 2, w, h - h / 2), 90f, new[] { 0, 200 }, new[] { 0f, 1f });
      Shade(g, new Rectangle(0, 0, w, (int)(h * 0.4)), 90f, new[] { 140, 0 }, new[] { 0f, 1f });
      if (logo != null) g.DrawImage(logo, logoBox);
      else using (var f = new Font("Segoe UI", 34f, FontStyle.Bold)) Shadowed(g, "GoofyTrack", f, Color.White, Margin44, P(28));
    }
  }

  // an ink gradient over r: alphas at positions, along angle (0: left to right, 90: top to bottom)
  static void Shade(Graphics g, Rectangle r, float angle, int[] alphas, float[] positions) {
    if (r.Width <= 0 || r.Height <= 0) return;
    var grown = new Rectangle(r.X - 1, r.Y - 1, r.Width + 2, r.Height + 2);   // the brush must not wrap at the edges
    using (var b = new LinearGradientBrush(grown, Color.Black, Color.Black, angle)) {
      var blend = new ColorBlend();
      blend.Colors = Array.ConvertAll(alphas, a => Color.FromArgb(a, Ink));
      blend.Positions = positions;
      b.InterpolationColors = blend;
      g.FillRectangle(b, r);
    }
  }

  static void Shadowed(Graphics g, string text, Font f, Color c, float x, float y) {
    using (var shadow = new SolidBrush(Color.FromArgb(c.A * 150 / 255, 0, 0, 0))) g.DrawString(text, f, shadow, x + 1, y + 2, StringFormat.GenericTypographic);
    using (var b = new SolidBrush(c)) g.DrawString(text, f, b, x, y, StringFormat.GenericTypographic);
  }

  // the bar that moves while a step runs, under the state line
  Rectangle BarBox() { return new Rectangle(Margin44, logoBottom + P(50), P(280), P(3)); }

  protected override void OnPaint(PaintEventArgs e) {
    if (ClientSize.Width <= 0 || ClientSize.Height <= 0) return;
    if (scene == null || scene.Size != ClientSize) BuildScene();
    var g = e.Graphics;
    g.DrawImageUnscaled(scene, 0, 0);
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
    int w = ClientSize.Width, h = ClientSize.Height, m = Margin44;

    // where things stand, under the logo
    Shadowed(g, stateText, stateFont, stateError ? Bad : Color.White, m, logoBottom + P(16));
    if (busy) {
      var bar = BarBox();
      using (var b = new SolidBrush(Color.FromArgb(50, 255, 255, 255))) g.FillRectangle(b, bar);
      int run = bar.Width / 3, x = (spin * P(5)) % (bar.Width + run) - run;
      var moving = Rectangle.Intersect(bar, new Rectangle(bar.X + x, bar.Y, run, bar.Height));
      using (var b = new SolidBrush(Accent)) if (moving.Width > 0) g.FillRectangle(b, moving);
    }

    foreach (var it in items) if (it.Primary) DrawPlay(g, it); else DrawRow(g, it);

    // the versions and the log's switch, at the bottom right
    float lineH = smallFont.GetHeight(g);
    var right = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Far };
    using (var b = new SolidBrush(Muted)) g.DrawString(versionText, smallFont, b, w - m, h - m + P(10) - lineH, right);
    string toggle = logShown ? "Masquer le journal" : "Afficher le journal";
    var size = g.MeasureString(toggle, smallFont, PointF.Empty, StringFormat.GenericTypographic);
    logToggle = new Rectangle((int)(w - m - size.Width) - P(4), (int)(h - m + P(10) - 2 * lineH - P(8)) - P(4), (int)size.Width + P(8), (int)lineH + P(8));
    bool hot = toggleHot;
    using (var f = new Font(smallFont, hot ? FontStyle.Underline : FontStyle.Regular))
    using (var b = new SolidBrush(hot ? Color.White : Muted))
      g.DrawString(toggle, f, b, w - m, logToggle.Y + P(4), right);
  }

  // a row: a dark bar from the window's edge, fading out to the right, with a red mark when the mouse is on it
  void DrawRow(Graphics g, Item it) {
    var r = it.Box;
    bool hot = it == hovered && it.Enabled && !busy;
    Shade(g, r, 0f, new[] { hot ? 205 : 130, hot ? 175 : 100, 0 }, new[] { 0f, 0.6f, 1f });
    using (var line = new LinearGradientBrush(new Rectangle(r.X - 1, r.Y, r.Width + 2, 1), Color.FromArgb(55, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 0f)) {
      g.FillRectangle(line, r.X, r.Top, r.Width, 1);
      g.FillRectangle(line, r.X, r.Bottom - 1, r.Width, 1);
    }
    if (hot) using (var b = new SolidBrush(Accent)) g.FillRectangle(b, r.X, r.Y, P(5), r.Height);
    float textH = rowFont.GetHeight(g);
    Shadowed(g, it.Text, rowFont, it.Enabled ? Color.White : Color.FromArgb(120, 255, 255, 255), Margin44 + (hot ? P(6) : 0), r.Y + (r.Height - textH) / 2);
    if (!string.IsNullOrEmpty(it.Hint)) {
      float hintH = hintFont.GetHeight(g);
      var right = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Far };
      float hx = r.Right - P(28), hy = r.Y + (r.Height - hintH) / 2;
      using (var b = new SolidBrush(it.Dot ? Color.White : Muted)) g.DrawString(it.Hint, hintFont, b, hx, hy, right);
      if (it.Dot) {
        float tw = g.MeasureString(it.Hint, hintFont, PointF.Empty, StringFormat.GenericTypographic).Width;
        using (var b = new SolidBrush(Accent)) g.FillEllipse(b, hx - tw - P(14), r.Y + r.Height / 2f - P(4), P(8), P(8));
      }
    }
  }

  // the Play button: red, rounded, with a play mark
  void DrawPlay(Graphics g, Item it) {
    var r = it.Box;
    bool hot = it == hovered && it.Enabled && !busy;
    using (var shadow = Rounded(new Rectangle(r.X, r.Y + P(4), r.Width, r.Height), P(10)))
    using (var b = new SolidBrush(Color.FromArgb(it.Enabled ? 110 : 60, 0, 0, 0))) g.FillPath(b, shadow);
    using (var path = Rounded(r, P(10)))
    using (var b = new SolidBrush(!it.Enabled ? Color.FromArgb(62, 66, 80) : hot ? AccentHot : Accent)) g.FillPath(b, path);
    Color fore = it.Enabled ? Color.White : Color.FromArgb(150, 255, 255, 255);
    float cx = r.X + P(30), cy = r.Y + r.Height / 2f, t = P(9);
    using (var b = new SolidBrush(fore)) g.FillPolygon(b, new[] { new PointF(cx - t * 0.7f, cy - t), new PointF(cx - t * 0.7f, cy + t), new PointF(cx + t, cy) });
    float textH = playFont.GetHeight(g);
    using (var b = new SolidBrush(fore)) g.DrawString(it.Text, playFont, b, r.X + P(56), r.Y + (r.Height - textH) / 2, StringFormat.GenericTypographic);
  }

  static GraphicsPath Rounded(Rectangle r, int radius) {
    int d = radius * 2;
    var path = new GraphicsPath();
    path.AddArc(r.X, r.Y, d, d, 180, 90);
    path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
    path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    path.CloseFigure();
    return path;
  }

  Item ItemAt(Point p) {
    foreach (var it in items) if (it.Box.Contains(p)) return it;
    return null;
  }

  protected override void OnMouseMove(MouseEventArgs e) {
    base.OnMouseMove(e);
    var it = ItemAt(e.Location);
    bool onToggle = logToggle.Contains(e.Location);
    if (it != hovered || onToggle != toggleHot) { hovered = it; toggleHot = onToggle; Invalidate(); }
    Cursor = onToggle || (it != null && it.Enabled && !busy) ? Cursors.Hand : Cursors.Default;
  }

  protected override void OnMouseLeave(EventArgs e) {
    base.OnMouseLeave(e);
    hovered = null;
    toggleHot = false;
    Invalidate();
  }

  protected override void OnMouseClick(MouseEventArgs e) {
    base.OnMouseClick(e);
    if (e.Button != MouseButtons.Left) return;
    if (logToggle.Contains(e.Location)) { ShowLog(!logShown); return; }
    var it = ItemAt(e.Location);
    if (it != null && it.Enabled && !busy) it.Run();
  }

  void ShowLog(bool on) {
    logShown = on;
    logPanel.Visible = on;
    Invalidate();
  }

  // ---------------------------------------------------------------- what the actions do

  string Exe { get { return Path.Combine(root, "GoofyTrack.exe"); } }

  void Start() {
    // what an update left behind (update.js renames this exe before copying the new one over it)
    try { File.Delete(Application.ExecutablePath + ".old"); } catch { }
    if (!File.Exists(Path.Combine(root, "sources", "update.js"))) {
      Fail("Le lanceur doit rester dans le dossier GoofyTrack, à côté du dossier sources.");
      return;
    }
    if (!HasNode()) {
      Fail("Node.js est introuvable : installez-le depuis nodejs.org puis rouvrez le lanceur.");
      if (MessageBox.Show(this, "GoofyTrack a besoin de Node.js (version 18 ou plus récente) pour s'installer et se mettre à jour.\n\nOuvrir nodejs.org ?", "GoofyTrack", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
        Process.Start("https://nodejs.org");
      return;
    }
    Refresh(null);
  }

  void Fail(string message) {
    versionText = "";
    stateError = true;
    stateText = message;
    Log(message);
    Invalidate();
  }

  static bool HasNode() {
    try {
      var p = Process.Start(new ProcessStartInfo("node", "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
      p.WaitForExit(10000);
      return p.ExitCode == 0;
    } catch { return false; }
  }

  // Asks update.js where things stand, then sets the actions
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
    if (status == null) { Fail("Impossible de lire l'état de GoofyTrack (voir le journal)."); ShowLog(true); return; }
    bool hasGame = B("hasGame"), update = B("updateAvailable");
    string installed = S("installed"), source = S("source"), latest = S("latest"), error = S("error");

    versionText = (hasGame && installed != null ? "Version installée " + installed : "Jeu pas encore installé")
      + "   ·   Dernière version " + (latest ?? "inconnue");
    stateError = false;
    if (error != null) { stateError = true; stateText = "Impossible de vérifier les mises à jour : " + error; }
    else if (!hasGame) stateText = "Installez le jeu : il se télécharge tout seul.";
    else if (update) stateText = "Une nouvelle version est disponible.";
    else if (installed != source) stateText = "Le jeu n'a pas encore la version " + source + " du code : reconstruisez-le.";
    else stateText = "GoofyTrack est à jour.";

    updateItem.Dot = false;
    if (!hasGame) { updateItem.Text = "Installer le jeu"; updateItem.Hint = "Environ 150 Mo, une seule fois"; updateItem.Enabled = true; }
    else if (update) {
      updateItem.Text = "Mettre à jour le jeu";
      updateItem.Hint = B("git") || latest == null ? "Nouvelle version disponible" : "Version " + latest + " disponible";
      updateItem.Dot = true;
      updateItem.Enabled = true;
    } else { updateItem.Text = "Mettre à jour le jeu"; updateItem.Hint = "Déjà à jour"; updateItem.Enabled = false; }
    rebuildItem.Enabled = hasGame;
    rebuildItem.Hint = hasGame && installed != source ? "Conseillé : le code est en " + source : "Refait le jeu à partir du code";
    playItem.Enabled = hasGame;
    Invalidate();
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
    ShowLog(true);
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
      foreach (var it in items) it.Enabled = false;
      stateError = false;
      stateText = label;
      spinner.Start();
    } else spinner.Stop();
    Invalidate();
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
