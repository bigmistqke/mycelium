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
   * Where a reading lands, made if the document carries none yet.
   *
   * A document holds the reading its last run recorded, and that value is stale
   * the moment this page opens. Clearing it before the probe runs keeps a
   * reader from taking the old number for the new one.
   *
   * @param {Element} entry
   * @returns {Element}
   */
  function readingIn(entry) {
    var found = entry.querySelector("notebook-reading")
    if (!found) {
      found = document.createElement("notebook-reading")
      var script = entry.querySelector("script")
      if (script && script.nextSibling) entry.insertBefore(found, script.nextSibling)
      else entry.appendChild(found)
    }
    return found
  }

  function run() {
    var entry = document.querySelector("notebook-experiment")
    if (!entry) return
    var script = entry.querySelector(':scope > script[type="text/mycelium-experiment"]')
    if (!script) return

    var reading = readingIn(entry)
    reading.textContent = "…"
    reading.setAttribute("data-state", "running")

    var made
    try {
      // An async wrapper, so a probe awaits settle() without declaring
      // anything, and returns its reading with a plain return.
      made = new Function(
        "fixture",
        "settle",
        '"use strict";return (async function () {\n' + (script.textContent || "") + "\n})()",
      )
    } catch (err) {
      reading.textContent = "the probe did not parse — " + (err && err.message)
      reading.setAttribute("data-state", "failed")
      return
    }

    var fixture = entry.querySelector("notebook-fixture")
    Promise.resolve()
      .then(function () { return made(fixture, settle) })
      .then(function (value) {
        // A probe returning nothing measured nothing, and saying so beats
        // recording the word undefined as though it were a finding.
        if (value === undefined) throw new Error("the probe returned no reading")
        reading.textContent = String(value)
        reading.setAttribute("data-state", "done")
      })
      .catch(function (err) {
        reading.textContent = String((err && err.message) || err)
        reading.setAttribute("data-state", "failed")
      })
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run)
  else run()
})()
