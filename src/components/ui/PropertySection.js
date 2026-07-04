const { createElement: h } = React;

const PropertySection = ({ title, children, c }) => (
    React.createElement('div', { style: { marginBottom: '14px' } },
        React.createElement('div', {
            style: {
                fontSize: '11px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: c.textDim,
                marginBottom: '8px',
                letterSpacing: '0.5px'
            }
        }, title),
        children
    )
);

export { PropertySection };
