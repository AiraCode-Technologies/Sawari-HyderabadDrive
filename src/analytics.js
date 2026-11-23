// Usage events for Google Tag Manager (GTM-M5SGHS7J, loaded in each page's <head> on the
// live site only). Each event is pushed to the data layer; GTM's GA4 tags pick them up by
// name. No personal data: route ids, scores, times and how something was shared.
//
//   drive_start        route, time_of_day, traffic, device ('touch' | 'keyboard'), challenge
//   drive_finish       route, score, seconds, faults, challenge_result ('won' | 'lost' | none)
//   share_card         route, score, method ('shared' | 'downloaded' | ...)
//   challenge_panel    route, score               (the share row under "Challenge a friend" opened)
//   challenge_share    route, score, method ('whatsapp' | 'facebook' | 'x' | 'linkedin' |
//                      'telegram' | 'instagram' | 'copy' | 'more')
//   challenge_opened   route, challenger_score    (someone arrived from a challenge link)
//   site_share         method                     (the website footer's share buttons)
//   drive_quit         route, how ('menu' | 'restart' | 'closed'), seconds, progress_pct, faults
//   route_loaded       route, load_ms, device
//   performance_low    route, device, fps, quality (still slow at the lowest resolution; once a drive)
//   webgl_unsupported  route, device             (the device cannot show 3D at all)
//   play_click         page, route, from_blog     (a link into the game; from_blog: from an article)
//   drive_finish also carries fault_types ("speeding:2,indicator:1") and top_fault
// Every event also goes to Microsoft Clarity (live site only) as a custom event, so its
// session recordings can be filtered by it (for example, drives that were quit part-way).
export function track(event, params = {}) {
  try {
    (window.dataLayer = window.dataLayer || []).push({ event, ...params });
    window.clarity?.('event', event);
  } catch {
    /* analytics must never break the game */
  }
}
