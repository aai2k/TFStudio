/** Strip HTML tags and decode the handful of entities used in RII YAML text fields. */
export function _stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
