// The site's own script: inserts a tracker the way the case named in data-case says, then marks the page as done.
;(function () {
  var c = document.currentScript.getAttribute('data-case')
  var url = 'https://tracker.cloveconsent.test/tracker.js?case=' + c
  var box = document.getElementById('box')
  if (c === 'append') {
    var s = document.createElement('script')
    s.src = url
    document.head.appendChild(s)
  } else if (c === 'consent-attr') {
    // data-consent alone does not make a marked tag: the script is still runnable
    var m = document.createElement('script')
    m.dataset.consent = 'x'
    m.src = url
    document.head.appendChild(m)
  } else if (c === 'setattribute') {
    var t = document.createElement('script')
    t.setAttribute('src', url)
    document.body.appendChild(t)
  } else if (c === 'innerhtml') {
    box.innerHTML = '<div><script src="' + url + '"></script></div>'
  } else if (c === 'adjacent') {
    box.insertAdjacentHTML('beforeend', '<script src="' + url + '"></script>')
  } else if (c === 'iframe') {
    var f = document.createElement('iframe')
    f.src = 'https://tracker.cloveconsent.test/frame.html?case=iframe'
    f.width = '320'
    f.height = '180'
    box.appendChild(f)
  } else if (c === 'lazy-markup-prop' || c === 'lazy-markup-attr') {
    // a lazy loader: an iframe built by markup (not createElement), its source set later
    box.innerHTML = '<iframe title="Lazy" width="320" height="180"></iframe>'
    var lf = box.firstChild
    var lu = 'https://tracker.cloveconsent.test/frame.html?case=' + c
    if (c === 'lazy-markup-prop') lf.src = lu
    else lf.setAttribute('src', lu)
  } else if (c === 'lazy-html-prop' || c === 'lazy-html-attr') {
    // the same on an iframe written in the HTML (lazy.html)
    var hf = document.getElementById('lazy-frame')
    var hu = 'https://tracker.cloveconsent.test/frame.html?case=' + c
    if (c === 'lazy-html-prop') hf.src = hu
    else hf.setAttribute('src', hu)
  } else if (c === 'lazy-script') {
    // an empty script written in the HTML (lazy.html) never ran: given a source, it would load and run
    document.getElementById('lazy-script').src = url
  } else if (c === 'iframe-html') {
    box.innerHTML = '<iframe src="https://tracker.cloveconsent.test/frame.html?case=iframe-html" width="320" height="180"></iframe>'
  }
  window.__caseDone = true
})()
