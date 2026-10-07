import { tablerIcon } from '../../../ui/tablerIcons.js';
import { CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import { NumInput } from '../../analysis/chrome/controls.js';
import { InlineRow } from '../chrome/panel.js';

const { createElement: h, useState } = React;

function IconButton({ c, icon, title, onClick, disabled }) {
    return h('button', {
        type: 'button', onClick, disabled, title, 'aria-label': title,
        style: {
            display: 'flex', alignItems: 'center', padding: 2, background: 'transparent', border: 'none',
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
        },
    }, tablerIcon(icon, 14));
}

/**
 * Whether an angle of incidence, in degrees, can be written. It is measured
 * from the normal, so it runs from 0 towards 90, and 90 itself is out: there
 * the light runs along the surface and never enters the coating. Any angle
 * short of 90 is taken, decimals included.
 */
export const angleAccepted = (deg) => deg >= 0 && deg < 90;

// One angle. NumInput clamps to a bound it is given, and 90 is no bound it
// could clamp to, so an entry outside the range is refused here instead: the
// field is mounted afresh under a new key and shows the angle it holds again.
function AngleInput({ c, value, onChange }) {
    const [refused, setRefused] = useState(0);
    return h(NumInput, {
        key: refused, value, step: 1, c, width: 56,
        onChange: (deg) => (angleAccepted(deg) ? onChange(deg) : setRefused(count => count + 1)),
    });
}

/**
 * The angles of incidence for ANG, degrees in the incident medium. CODE V takes
 * up to five (CODEV_LIMITS.angles), and at least one is kept. A new angle starts
 * as a copy of the last one.
 */
export function AnglesField({ c, z, anglesDeg, setAnglesDeg }) {
    const setAt = (at, value) => setAnglesDeg(anglesDeg.map((angle, index) => (index === at ? value : angle)));
    const removeAt = (at) => setAnglesDeg(anglesDeg.filter((_, index) => index !== at));
    const full = anglesDeg.length >= CODEV_LIMITS.angles;
    return h(InlineRow, { c, label: z.angles },
        anglesDeg.map((angle, index) => h('div', { key: index, style: { display: 'flex', alignItems: 'center' } },
            h(AngleInput, { c, value: angle, onChange: (value) => setAt(index, value) }),
            anglesDeg.length > 1
                ? h(IconButton, { c, icon: 'x', title: z.removeAngle, onClick: () => removeAt(index) })
                : null,
        )),
        h(IconButton, {
            c, icon: 'plus', title: full ? z.anglesFull(CODEV_LIMITS.angles) : z.addAngle, disabled: full,
            onClick: () => setAnglesDeg([...anglesDeg, anglesDeg[anglesDeg.length - 1] ?? 0]),
        }),
    );
}
