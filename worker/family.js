// Bars, pubs and clubs are left out of family evenings. Qloo sometimes files a bar under another category
// ("Zodiac Bar, Club and Karaoke" as an event planner), so the name is checked too, as whole words only
// ("Barbecue House" and "Clubhouse Diner" stay in).
const ADULTISH = /bar$|bar_|pub|club|disco|lounge|brewery|tavern|karaoke|night/;
const ADULTISH_NAME = /\b(bar|club|pub|karaoke|lounge|tavern|disco|nightclub)\b/i;
export function familyFriendly(category, name = '') {
  return !ADULTISH.test(String(category || '').replace(/ /g, '_')) && !ADULTISH_NAME.test(name);
}
