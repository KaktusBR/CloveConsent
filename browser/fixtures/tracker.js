// The fake tracker: served for https://tracker.cloveconsent.test/tracker.js by the test's route. Records that it ran, per case.
;(window.__trackerRuns = window.__trackerRuns || []).push(new URL(document.currentScript.src).searchParams.get('case'))
