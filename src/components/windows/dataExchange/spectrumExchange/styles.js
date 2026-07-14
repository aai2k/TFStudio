export function makeLayoutStyles(c) {
    return {
        wrap: {
            display: 'flex', flexDirection: 'column', height: '100%', background: c.bg,
            color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        section: {
            padding: '12px 14px', borderBottom: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', gap: 10,
        },
        rowFlex: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    };
}
