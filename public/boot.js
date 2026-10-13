// VRift start-up screen (see index.html). A separate file, not an inline script, so it also runs
// on sites whose Content-Security-Policy blocks inline scripts (the website's live demo).
// Each step is ticked off by the code that actually does it (main.tsx, App.tsx), so the list
// shows what VRift is really doing. Errors before the editor appears are shown here.
(function () {
  var t0 = performance.now();
  try {
    var c = JSON.parse(localStorage.getItem("vrift.bootColors") || "null");
    if (c) for (var k in c) document.documentElement.style.setProperty("--boot-" + k, c[k]);
  } catch (e) {}
  var steps = [
    ["code", "Loading VRift's code"],
    ["fonts", "Loading fonts"],
    ["ui", "Starting the editor"],
  ];
  var list = document.getElementById("boot-steps");
  var note = document.getElementById("boot-note");
  var clock = document.getElementById("boot-clock");
  var state = {};
  var finished = false;
  steps.forEach(function (s) {
    var li = document.createElement("li");
    li.innerHTML = '<span class="mark">·</span><span class="label"></span><span class="ms"></span>';
    li.querySelector(".label").textContent = s[1];
    list.appendChild(li);
    state[s[0]] = { li: li, start: null };
  });
  function begin(id) {
    var s = state[id];
    if (!s || s.start !== null) return;
    s.start = performance.now();
    s.li.className = "active";
    s.li.querySelector(".mark").textContent = "▸";
  }
  function done(id) {
    var s = state[id];
    if (!s) return;
    if (s.start === null) s.start = performance.now();
    s.li.className = "done";
    s.li.querySelector(".mark").textContent = "✓";
    s.li.querySelector(".ms").textContent = Math.round(performance.now() - s.start) + " ms";
    var i = steps.findIndex(function (x) { return x[0] === id; });
    if (steps[i + 1]) begin(steps[i + 1][0]);
  }
  function fail(message) {
    if (finished) return;
    finished = true;
    clock.textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s";
    for (var i = 0; i < steps.length; i++) {
      var s = state[steps[i][0]];
      if (s.li.className === "active") {
        s.li.className = "failed";
        s.li.querySelector(".mark").textContent = "✕";
      }
    }
    note.className = "note err";
    note.textContent = "VRift could not start:\n" + message;
    var b = document.createElement("button");
    b.textContent = "try again";
    b.onclick = function () { location.reload(); };
    note.parentNode.appendChild(b);
  }
  var tick = setInterval(function () {
    if (finished) return clearInterval(tick);
    var secs = (performance.now() - t0) / 1000;
    clock.textContent = secs.toFixed(1) + " s";
    if (secs > 15 && !note.textContent) note.textContent = "This is taking longer than usual. VRift is still working.";
  }, 100);
  window.addEventListener("error", function (e) {
    fail(e.error && e.error.stack ? String(e.error.stack) : e.message || "A script failed to load.");
  });
  // a script or stylesheet that cannot be fetched only reports on its own tag
  window.addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (t && (t.tagName === "SCRIPT" || (t.tagName === "LINK" && t.rel === "stylesheet"))) fail("Could not load " + (t.src || t.href) + ".");
    },
    true,
  );
  window.addEventListener("unhandledrejection", function (e) {
    fail(e.reason && e.reason.stack ? String(e.reason.stack) : String(e.reason));
  });
  window.__vriftBoot = {
    begin: begin,
    done: done,
    fail: function (e) { fail(e && e.stack ? String(e.stack) : String(e)); },
    finish: function () {
      if (finished) return;
      steps.forEach(function (s) { if (state[s[0]].li.className !== "done") done(s[0]); });
      finished = true;
      var el = document.getElementById("boot");
      el.className = "gone";
      setTimeout(function () { el.remove(); }, 250);
    },
  };
  begin("code");
})();
