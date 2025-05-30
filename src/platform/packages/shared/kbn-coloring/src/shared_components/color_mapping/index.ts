/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export {
  CategoricalColorMapping,
  type ColorMappingProps,
  type ColorMappingInputCategoricalData,
  type ColorMappingInputContinuousData,
} from './categorical_color_mapping';
export type { ColorMappingInputData } from './categorical_color_mapping';
export type { ColorMapping } from './config';
export * from './color/color_handling';
export { getValueKey } from './color/utils';
export { SPECIAL_TOKENS_STRING_CONVERSION, getSpecialString } from './special_tokens';
export { type ColorAssignmentMatcher } from './color/color_assignment_matcher';
export {
  DEFAULT_COLOR_MAPPING_CONFIG,
  DEFAULT_OTHER_ASSIGNMENT_INDEX,
  getPaletteColors,
  getColorsFromMapping,
} from './config/default_color_mapping';
export * from './components/assignment/utils';
