// Pieces of the tools' argument schemas.

/** An object of `properties` that takes no other argument. */
export const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const num = description => ({ type: 'number', description });
export const int = description => ({ type: 'integer', description });
export const str = description => ({ type: 'string', description });
export const bool = description => ({ type: 'boolean', description });
export const list = (items, description) => ({ type: 'array', items, description });
export const oneOf = (values, description) => ({ type: 'string', enum: values, description });

export const DESIGN_ID = str('The id of a design in this session, such as "d1", from openDesign, newDesign, copyDesign or a finished job');
export const SIDE = oneOf(['front', 'back'], "The coating: 'front' faces the incident medium, 'back' the exit medium. Default 'front'");
export const INDEX = int('Layer index on that side as the design stores it: on the front 0 is the outermost layer, next to the incident medium; on the back 0 is the layer on the substrate');
