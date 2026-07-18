export function sanitizeId(name) {
    return (name || 'material')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'material';
}
