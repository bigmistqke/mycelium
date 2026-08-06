// Behaviour for the test-* vocabulary. A classic script and not a module, for
// the reason figure.element.js gives: a document here opens over file://,
// module scripts are CORS-checked, and that origin cannot satisfy the check.
//
// This script is the whole runner. Whoever opened the page reads the verdicts
// out of the same document afterwards, whether that is a person looking at it
// or the CLI driving a browser over WebDriver. There is no second harness to
// keep in step with this one, which is the point of putting the runner in the
// page rather than in the tool.
;(function () {
  "use strict"

  function statusOf(testCase) {
    return testCase.querySelector("test-status")
  }

  function verdictOf(testCase) {
    var el = statusOf(testCase)
    return el ? (el.textContent || "").trim() : ""
  }

  // A message field exists only once something has to go in it. The schema
  // rejects an empty field, so a document on disk carries none, and the runner
  // adds one at the moment a case has something to say.
  function say(testCase, text) {
    var el = testCase.querySelector("test-message")
    if (!el) {
      el = document.createElement("test-message")
      var status = statusOf(testCase)
      status.parentNode.insertBefore(el, status.nextSibling)
    }
    el.textContent = text
  }

  // The verdict goes in the text, because that is what a reader and the CLI
  // both read, and into data-verdict as well, because CSS cannot select on
  // text. One call writes both, so the two can never disagree. Neither reaches
  // a file: an audit holds every committed status at PENDING.
  function write(testCase, verdict, text) {
    var el = statusOf(testCase)
    if (el) {
      el.textContent = verdict
      el.setAttribute("data-verdict", verdict)
    }
    if (text) say(testCase, text)
  }

  // Waits until an element stops changing. Everything a drawing engine produces
  // lands in the markup — path coordinates, the inline position on a label — so
  // comparing two samples answers "has it finished" without this code knowing
  // anything about what drew it.
  //
  // One animation frame is not enough. An engine draws in one frame and a
  // ResizeObserver can redraw in the next, so a single frame reports on a
  // figure that is still moving.
  function settle(el, frames) {
    var target = el || document.body
    var left = frames || 60
    var last = null
    return new Promise(function (resolve, reject) {
      function tick() {
        var now = target.innerHTML
        if (last !== null && now === last) return resolve(target)
        if (left-- <= 0) return reject(new Error("the fixture never stopped changing"))
        last = now
        requestAnimationFrame(function () { setTimeout(tick, 0) })
      }
      tick()
    })
  }

  function assert(ok, text) {
    if (!ok) throw new Error(text || "assertion failed")
  }

  // Geometry rarely lands on a whole number. Two values that one formula
  // derived from one set of boxes still differ in the last bits once a browser
  // has rounded a layout, so comparing measured numbers needs a tolerance to
  // mean anything at all.
  assert.near = function (a, b, tolerance, text) {
    var slack = tolerance === undefined ? 0.5 : tolerance
    if (!(Math.abs(a - b) <= slack)) {
      throw new Error((text || "expected these to match") + ": " + a + " and " + b + " differ by more than " + slack)
    }
  }

  function run(testCase) {
    var script = testCase.querySelector('script[type="text/mycelium-test"]')
    if (!script) {
      write(testCase, "FAILURE", "this case carries no <script type=\"text/mycelium-test\">")
      return Promise.resolve()
    }
    var made
    try {
      // An async wrapper, so a case awaits settle() without declaring anything.
      made = new Function("fixture", "settle", "assert",
        '"use strict";return (async function () {\n' + script.textContent + "\n})()")
    } catch (err) {
      write(testCase, "FAILURE", "this case does not parse: " + err.message)
      return Promise.resolve()
    }
    var fixture = testCase.querySelector("test-fixture")
    var started
    try {
      started = made(fixture, settle, assert)
    } catch (err) {
      write(testCase, "FAILURE", (err && err.message) || String(err))
      return Promise.resolve()
    }
    return started.then(
      function () { write(testCase, "SUCCESS") },
      function (err) { write(testCase, "FAILURE", (err && err.message) || String(err)) }
    )
  }

  function cases() {
    return Array.prototype.slice.call(document.querySelectorAll("test-case"))
  }

  // A plain div rather than a test-* element. Anything carrying the family's
  // prefix belongs to the schema, and this belongs to a run. Naming it
  // test-summary would add a field to the template that no document may ever
  // write, since this one never reaches a file.
  function summarise() {
    var all = cases()
    var passed = all.filter(function (c) { return verdictOf(c) === "SUCCESS" }).length
    var failed = all.filter(function (c) { return verdictOf(c) === "FAILURE" }).length
    var pending = all.length - passed - failed
    var el = document.querySelector(".test-summary")
    if (!el) {
      el = document.createElement("div")
      el.className = "test-summary"
      var doc = document.querySelector("test-doc")
      if (doc) doc.insertBefore(el, doc.firstChild)
    }
    el.setAttribute("data-verdict", failed || pending ? "FAILURE" : "SUCCESS")
    el.textContent = all.length + " cases · " + passed + " passed · " + failed + " failed" +
      (pending ? " · " + pending + " still pending" : "")
  }

  // One at a time. Two cases measuring layout at once read each other's
  // reflows, and a test whose answer depends on what else is running is worse
  // than no test.
  function runAll() {
    cases().reduce(function (chain, testCase) {
      return chain.then(function () { return run(testCase) })
    }, Promise.resolve()).then(summarise)
  }

  // An error at the level of the page means something outside any case failed,
  // and the usual cause is a subject script that never loaded. Every case still
  // reading PENDING is a casualty of that. Saying so beats leaving a document
  // that looks like it is still working, and it turns a run that would hang at
  // the deadline into one that reports a reason.
  function derail(text) {
    cases().forEach(function (testCase) {
      if (verdictOf(testCase) === "PENDING") write(testCase, "FAILURE", text)
    })
    summarise()
  }

  // A browser reports this one when something resizes an element while resize
  // notifications for it are still going out. Nothing threw and nothing fell
  // through: the remaining notifications arrive in the next frame. It
  // reaches window.onerror all the same, and failing every pending case over it
  // would report a broken page whenever a figure grew a row to fit its labels.
  function benign(message) {
    return /ResizeObserver loop/.test(message || "")
  }

  window.addEventListener("error", function (ev) {
    if (benign(ev.message)) return
    derail("the page failed: " + (ev.message || "a resource did not load"))
  })
  window.addEventListener("unhandledrejection", function (ev) {
    derail("the page failed: " + ev.reason)
  })

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAll)
  } else {
    runAll()
  }
})()
