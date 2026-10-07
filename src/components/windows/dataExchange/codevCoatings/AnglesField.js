import { tablerIcon } from '../../../ui/tablerIcons.js';
import { CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import { Num } from '../zemaxCoatings/ui.js';
import { Field } from './parts.js';

const { createElement: h } = React;

function IconButton({ c, icon, title, onClick, disabled }) {
    return h('button', {
        onClick, disabled, title, 'aria-label': title,
        style: {
            display: 'flex', alignItems: 'center', padding: 2, background: 'transparent', border: 'none',
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
        },
    }, tablerIcon(icon, 14));
}

/**
 * The angles of incidence for ANG, degrees in the incident medium. CODE V takes
 * up to five (CODEV_LIMITS.angles), and at least one is kept. A new angle starts
 * as a copy of the last one. Angles run 0 to 89 degrees, as in every angle field
 * of the program.
 */
export function AnglesField({ c, z, anglesDeg, setAnglesDeg }) {
    const setAt = (at, value) => setAnglesDeg(anglesDeg.map((angle, index) => (index === at ? value : angle)));
    const removeAt = (at) => setAnglesDeg(anglesDeg.filter((_, index) => index !== at));
    const full = anglesDeg.length >= CODEV_LIMITS.angles;
    return h(Field, { c, label: z.angles },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            anglesDeg.map((angle, index) => h('div', { key: index, style: { display: 'flex', alignItems: 'center' } },
                h(Num, { value: angle, onChange: (value) => setAt(index, value), min: 0, max: 89, step: 1, c, width: 52 }),
                anglesDeg.length > 1
                    ? h(IconButton, { c, icon: 'x', title: z.removeAngle, onClick: () => removeAt(index) })
                    : null,
            )),
            h(IconButton, {
                c, icon: 'plus', title: full ? z.anglesFull(CODEV_LIMITS.angles) : z.addAngle, disabled: full,
                onClick: () => setAnglesDeg([...anglesDeg, anglesDeg[anglesDeg.length - 1] ?? 0]),
            }),
        ),
    );
}
