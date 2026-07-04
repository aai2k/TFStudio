const { createElement: h } = React;
const { useState, useEffect, useRef } = React;

import { hasInvalidSymbols, isValidNumberInput } from '../../utils/misc/numberParsing.js';

/**
 * DebouncedInput - Input component that prevents UI freezing during typing
 * Maintains local state and only propagates changes on blur or Enter key
 *
 * Features:
 * - Local state prevents re-renders from interrupting typing
 * - Press Enter to save and move to next input (if onEnterKey provided)
 * - Immediate save on blur
 * - No auto-save while typing - user stays in control
 * - Red glow for invalid number inputs (invalid symbols or malformed numbers)
 */
const DebouncedInput = ({ value, onChange, onBlur, onEnterKey, debounceMs = 500, style, validateNumber = true, ...props }) => {
    const [localValue, setLocalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const [isInvalid, setIsInvalid] = useState(false);
    const isNavigatingRef = useRef(false);

    // Update local value when prop value changes (external update)
    // but only if the input is not currently focused (being edited by user)
    useEffect(() => {
        if (!isFocused) {
            setLocalValue(value);
            setIsInvalid(false); // Reset validation on external update
        }
    }, [value, isFocused]);

    const handleFocus = (e) => {
        setIsFocused(true);
        setIsInvalid(false); // Clear invalid state when user starts editing
    };

    const handleChange = (e) => {
        const newValue = e.target.value;
        setLocalValue(newValue);

        // Validate input in real-time if validation is enabled
        if (validateNumber) {
            // Check for invalid symbols first (immediate feedback)
            if (hasInvalidSymbols(newValue)) {
                setIsInvalid(true);
            } else if (newValue.trim() === '') {
                // Empty is valid (will default to 0)
                setIsInvalid(false);
            } else {
                // Check if it's a valid number or valid partial input
                setIsInvalid(!isValidNumberInput(newValue));
            }
        }

        // No auto-save - only save on blur or Enter
    };

    const handleBlur = (e) => {
        // If we're navigating via Enter key, don't process blur
        // The navigation will handle focus transition
        if (isNavigatingRef.current) {
            isNavigatingRef.current = false;
            return;
        }

        setIsFocused(false);

        // Immediately propagate the change on blur
        if (onChange && localValue !== value) {
            onChange(localValue);
        }

        // Call the onBlur callback if provided
        if (onBlur) {
            onBlur(e);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();

            // Immediately propagate the change
            if (onChange && localValue !== value) {
                onChange(localValue);
            }

            // Only do the "navigating away" bookkeeping when we actually move
            // focus (onEnterKey). M8: doing it unconditionally left the field
            // DOM-focused but state-unfocused with isNavigatingRef stuck true —
            // so prop-resync clobbered further typing AND the next real blur was
            // swallowed (discarding edits made after Enter). Without navigation,
            // Enter just commits and the field stays normally editable.
            if (onEnterKey) {
                isNavigatingRef.current = true;   // suppress the focus-move blur
                setIsFocused(false);
                onEnterKey();
            }
        }
    };

    // Merge styles: add red glow if invalid
    const inputStyle = {
        ...style,
        ...(isInvalid && {
            boxShadow: '0 0 0 2px rgba(255, 50, 50, 0.5), 0 0 8px rgba(255, 0, 0, 0.3)',
            borderColor: '#ff3232',
            transition: 'box-shadow 0.2s ease, border-color 0.2s ease'
        })
    };

    return h('input', {
        ...props,
        type: 'text',
        value: localValue,
        onFocus: handleFocus,
        onChange: handleChange,
        onBlur: handleBlur,
        onKeyDown: handleKeyDown,
        style: inputStyle,
        'aria-invalid': isInvalid
    });
};

export { DebouncedInput };
