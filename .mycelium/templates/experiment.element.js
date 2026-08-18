// Behaviour for a notebook experiment that runs in a page. A classic script and
// not a module, for the reason figure.element.js gives: a document here opens
// over file://, module scripts are CORS-checked, and that origin cannot satisfy
// the check.
//
// The runner goes in the page for the reason test.element.js gives too. Whoever
// opened the document reads the measurement out of it afterwards, whether that
// is a person looking at the page or the command driving a browser, and no
// second harness exists to keep in step with this one.
//
// What it does not share with test.element.js is the verdict. A check knows the
// answer it expects and fails when the page disagrees; a probe has no
// expectation, returns what it read, and finds its meaning by disagreeing with
// its own last reading.
//
// @ts-check
;(function () {
  "use strict"

  /**
   * Waits until an element stops changing, so a probe measures a drawing that
   * has finished drawing.
   *
   * Copied from test.element.js rather than shared with it. Both files are
   * classic scripts, so neither can import the other, and a third script
   * defining a global costs more than twenty lines do.
   *
   * @param {Element | null} [el]
   * @param {number} [frames]
   * @returns {Promise<Element>}
   */
  function settle(el, frames) {
    var target = el || document.body
    var left = frames || 60
    /** @type {string | null} */
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

  /**
   * Puts a reading at the top of its case, where the newest one belongs.
   *
   * The page writes the reading in the shape the file would hold it, dated
   * today, so what a person sees here is what recording it would keep. Nothing
   * saves it: the command reads the answer back and writes the document.
   *
   * @param {Element} one
   * @param {string} value
   * @returns {void}
   */
  function show(one, value) {
    var el = document.createElement("notebook-reading")
    el.setAttribute("data-on", new Date().toISOString().slice(0, 10))
    el.textContent = value
    var first = one.querySelector("notebook-reading")
    if (first) one.insertBefore(el, first)
    else one.appendChild(el)
  }

  // Copied from test.element.js's own reason(), for the same problem: err in
  // a catch is unknown, and only Error carries a message worth reading over
  // its own String() conversion.
  /**
   * @param {unknown} err
   * @returns {string}
   */
  function reason(err) {
    if (err instanceof Error) return err.message
    return String(err)
  }

  /**
   * @param {Element} one
   * @returns {void}
   */
  function runCase(one) {
    var script = one.querySelector(':scope > script[type="text/mycelium-experiment"]')
    if (!script) return
    one.setAttribute("data-state", "running")

    /** @type {((fixture: Element | null, settleFn: (el?: Element | null, frames?: number) => Promise<Element>) => Promise<unknown>) | undefined} */
    var made
    try {
      // An async wrapper, so a probe awaits settle() without declaring
      // anything, and returns its reading with a plain return.
      made = /** @type {any} */ (new Function(
        "fixture",
        "settle",
        '"use strict";return (async function () {\n' + (script.textContent || "") + "\n})()",
      ))
    } catch (err) {
      one.setAttribute("data-reading", "the probe did not parse — " + reason(err))
      one.setAttribute("data-state", "failed")
      return
    }

    var fixture = one.querySelector("notebook-fixture")
    Promise.resolve()
      .then(function () { return /** @type {NonNullable<typeof made>} */ (made)(fixture, settle) })
      .then(function (value) {
        // A probe returning nothing measured nothing, and saying so beats
        // recording the word undefined as though it were a finding.
        if (value === undefined) throw new Error("the probe returned no reading")
        one.setAttribute("data-reading", String(value))
        show(one, String(value))
        one.setAttribute("data-state", "done")
      })
      .catch(function (err) {
        one.setAttribute("data-reading", reason(err))
        one.setAttribute("data-state", "failed")
      })
  }

  function run() {
    // Every case runs, because the command may ask for any one of them and the
    // page has no way to know which. They are probes: each one reads and none
    // of them writes, so running the others costs time and nothing else.
    var cases = document.querySelectorAll("notebook-experiment > notebook-case")
    for (var i = 0; i < cases.length; i++) runCase(cases[i])
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run)
  else run()
})()
