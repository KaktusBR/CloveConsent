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
  } else if (c === 'iframe-html') {
    box.innerHTML = '<iframe src="https://tracker.cloveconsent.test/frame.html?case=iframe-html" width="320" height="180"></iframe>'
  }
  window.__caseDone = true
})()
