// The site's own code inserting trackers with createElement: one for a configured service (Meta Pixel) and one for a host no
// configured service covers (Hotjar), which stays blocked whatever the visitor allows.
for (const src of ['https://connect.facebook.net/en_US/fbevents.js?case=inserted', 'https://static.hotjar.com/c/hotjar.js?case=inserted']) {
  const s = document.createElement('script')
  s.src = src
  document.head.appendChild(s)
}
