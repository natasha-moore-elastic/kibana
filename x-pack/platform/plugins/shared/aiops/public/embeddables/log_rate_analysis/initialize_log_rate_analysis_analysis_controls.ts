/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StateComparators } from '@kbn/presentation-publishing';
import { BehaviorSubject } from 'rxjs';
import type {
  LogRateAnalysisComponentApi,
  LogRateAnalysisEmbeddableRuntimeState,
  LogRateAnalysisEmbeddableState,
} from './types';

type LogRateAnalysisEmbeddableCustomState = Omit<
  LogRateAnalysisEmbeddableState,
  'timeRange' | 'title' | 'description' | 'hidePanelTitles' | 'windowParameters'
>;

export const initializeLogRateAnalysisControls = (
  rawState: LogRateAnalysisEmbeddableRuntimeState
) => {
  const dataViewId = new BehaviorSubject(rawState.dataViewId);

  const updateUserInput = (update: LogRateAnalysisEmbeddableCustomState) => {
    dataViewId.next(update.dataViewId);
  };

  const serializeLogRateAnalysisChartState = (): LogRateAnalysisEmbeddableCustomState => {
    return {
      dataViewId: dataViewId.getValue(),
    };
  };

  const logRateAnalysisControlsComparators: StateComparators<LogRateAnalysisEmbeddableCustomState> =
    {
      dataViewId: 'referenceEquality',
    };

  return {
    logRateAnalysisControlsApi: {
      dataViewId,
      updateUserInput,
    } as LogRateAnalysisComponentApi,
    serializeLogRateAnalysisChartState,
    logRateAnalysisControlsComparators,
  };
};
