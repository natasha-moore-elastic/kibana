/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useState, useCallback } from 'react';
import { i18n } from '@kbn/i18n';

import { useMappingsState, useDispatch } from '../../../../mappings_state_context';
import { shouldDeleteChildFieldsAfterTypeChange, getAllDescendantAliases } from '../../../../lib';
import { NormalizedField, DataType } from '../../../../types';
import { PARAMETERS_DEFINITION } from '../../../../constants';

export type UpdateFieldFunc = (field: NormalizedField) => void;

interface State {
  isModalOpen: boolean;
  field?: NormalizedField;
  aliases?: string[];
}

export const useUpdateField = () => {
  const [state, setState] = useState<State>({
    isModalOpen: false,
  });
  const dispatch = useDispatch();

  const { fields } = useMappingsState();
  const { byId, aliases } = fields;

  const confirmButtonText = i18n.translate(
    'xpack.idxMgmt.mappingsEditor.updateField.confirmationModal.confirmDescription',
    {
      defaultMessage: 'Confirm type change',
    }
  );

  let modalTitle = '';

  if (state.field) {
    const { source } = state.field;

    modalTitle = i18n.translate(
      'xpack.idxMgmt.mappingsEditor.updateField.confirmationModal.title',
      {
        defaultMessage: "Confirm change ''{fieldName}'' type to ''{fieldType}''.",
        values: {
          fieldName: source.name,
          fieldType: source.type,
        },
      }
    );
  }

  const closeModal = () => {
    setState({ isModalOpen: false });
  };

  const updateField: UpdateFieldFunc = useCallback(
    (field) => {
      const previousField = byId[field.id];

      const willDeleteChildFields = (oldType: DataType, newType: DataType): boolean => {
        const { hasChildFields, hasMultiFields } = field;

        if (!hasChildFields && !hasMultiFields) {
          // No child or multi-fields will be deleted, no confirmation needed.
          return false;
        }

        return shouldDeleteChildFieldsAfterTypeChange(oldType, newType);
      };

      if (field.source.type !== previousField.source.type) {
        // Array of all the aliases pointing to the current field beeing updated
        const aliasesOnField = aliases[field.id] || [];

        // Array of all the aliases pointing to the current field + all its possible children
        const aliasesOnFieldAndDescendants = getAllDescendantAliases(field, fields);

        const isReferencedByAlias = aliasesOnField && Boolean(aliasesOnField.length);
        const nextTypeCanHaveAlias = !PARAMETERS_DEFINITION.path.targetTypesNotAllowed.includes(
          field.source.type
        );

        // We need to check if, by changing the type, we will also
        // delete possible child properties ("fields" or "properties").
        // If we will, we need to warn the user about it.
        let requiresConfirmation: boolean;
        let aliasesToDelete: string[] = [];

        if (isReferencedByAlias && !nextTypeCanHaveAlias) {
          aliasesToDelete = aliasesOnFieldAndDescendants;
          requiresConfirmation = true;
        } else {
          requiresConfirmation = willDeleteChildFields(
            previousField.source.type,
            field.source.type
          );
          if (requiresConfirmation) {
            aliasesToDelete = aliasesOnFieldAndDescendants.filter(
              // We will only delete aliases that points to possible children, *NOT* the field itself
              (id) => aliasesOnField.includes(id) === false
            );
          }
        }

        if (requiresConfirmation) {
          setState({
            isModalOpen: true,
            field,
            aliases: Boolean(aliasesToDelete.length)
              ? aliasesToDelete.map((id) => byId[id].path.join(' > ')).sort()
              : undefined,
          });
          return;
        }
      }

      dispatch({ type: 'field.edit', value: field.source });
    },
    [dispatch, aliases, fields, byId]
  );

  const confirmTypeUpdate = () => {
    dispatch({ type: 'field.edit', value: state.field!.source });
    closeModal();
  };

  return {
    updateField,
    modal: {
      isOpen: state.isModalOpen,
      props: {
        childFields: state.field && state.field.childFields,
        title: modalTitle,
        aliases: state.aliases,
        byId,
        confirmButtonText,
        onConfirm: confirmTypeUpdate,
        onCancel: closeModal,
      },
    },
  };
};
