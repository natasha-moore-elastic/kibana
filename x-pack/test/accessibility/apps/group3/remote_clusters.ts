/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ClusterPayloadEs } from '@kbn/remote-clusters-plugin/common/lib';
import { FtrProviderContext } from '../../ftr_provider_context';

const emptyPrompt = 'remoteClusterListEmptyPrompt';
const createButton = 'remoteClusterEmptyPromptCreateButton';
const pageTitle = 'remoteClusterPageTitle';
const nameLink = 'remoteClustersTableListClusterLink';
const editButton = 'remoteClusterTableRowEditButton';
const deleteButton = 'remoteClusterTableRowRemoveButton';
const deleteModalTitle = 'confirmModalTitleText';
const detailsTitle = 'remoteClusterDetailsFlyoutTitle';
const requestButton = 'remoteClustersRequestButton';
const requestTitle = 'remoteClusterRequestFlyoutTitle';
const selectApiKeyButton = 'setupTrustApiMode';
const trustStepNextButton = 'remoteClusterTrustNextButton';
const formStepNextButton = 'remoteClusterFormNextButton';
const addRemoteClusterButton = 'remoteClusterReviewtNextButton';
const closeFlyoutButton = 'euiFlyoutCloseButton';

interface Payload {
  persistent: {
    cluster: {
      remote: {
        [k: string]: ClusterPayloadEs;
      };
    };
  };
}

const getEmptyPayload = () =>
  ({
    persistent: {
      cluster: {
        remote: {},
      },
    },
  } as Payload);

const getPayloadClusterProxyMode = (name: string): Payload => {
  const payload = getEmptyPayload();
  payload.persistent.cluster.remote[name] = {
    mode: 'proxy',
    proxy_address: '127.0.0.1:9302',
    server_name: 'test_server',
  };
  return payload;
};

const getPayloadClusterSniffMode = (name: string): Payload => {
  const payload = getEmptyPayload();
  payload.persistent.cluster.remote[name] = {
    mode: 'sniff',
    seeds: ['127.0.0.1:9301'],
  };
  return payload;
};

const getDeleteClusterPayload = (name: string): Payload => {
  const payload = getEmptyPayload();
  payload.persistent.cluster.remote[name] = {
    skip_unavailable: null,
    mode: null,
    proxy_address: null,
    proxy_socket_connections: null,
    server_name: null,
    seeds: null,
    node_connections: null,
    proxy: null,
  };
  return payload;
};

export default function ({ getService, getPageObjects }: FtrProviderContext) {
  const PageObjects = getPageObjects(['common', 'security']);
  const testSubjects = getService('testSubjects');
  const esClient = getService('es');
  const a11y = getService('a11y');
  const retry = getService('retry');

  describe('Remote Clusters Accessibility', () => {
    before(async () => {
      await PageObjects.common.navigateToApp('remoteClusters');
    });

    describe('Add remote cluster', () => {
      it('renders the list view with empty prompt', async () => {
        await retry.waitFor('empty prompt to be rendered', async () => {
          return testSubjects.isDisplayed(emptyPrompt);
        });
        await a11y.testAppSnapshot();
      });

      it('renders add remote cluster form - trust step', async () => {
        await retry.waitFor('add remote cluster button to be rendered - trust step', async () => {
          return testSubjects.isDisplayed(createButton);
        });

        await testSubjects.click(createButton);
        await retry.waitFor('add remote cluster form to be rendered - trust step', async () => {
          return (await testSubjects.getVisibleText(pageTitle)) === 'Add remote cluster';
        });

        await a11y.testAppSnapshot();
      });

      it('renders add remote cluster form - form step', async () => {
        await retry.waitFor('select api key button to be rendered - form step', async () => {
          return testSubjects.isDisplayed(selectApiKeyButton);
        });

        await testSubjects.click(selectApiKeyButton);
        await testSubjects.click(trustStepNextButton);
        await retry.waitFor('next button form step to be rendered', async () => {
          return testSubjects.isDisplayed(formStepNextButton);
        });

        await a11y.testAppSnapshot();
      });

      it('renders request flyout', async () => {
        await testSubjects.click(requestButton);
        await retry.waitFor('request flyout to be rendered', async () => {
          return (await testSubjects.getVisibleText(requestTitle)) === 'Request';
        });

        await a11y.testAppSnapshot();
      });

      it('renders add remote cluster form - review step', async () => {
        await testSubjects.click(closeFlyoutButton);
        await testSubjects.setValue('remoteClusterFormNameInput', 'testRemoteCluster');
        await testSubjects.setValue('remoteClusterFormSeedsInput', '1:1');
        await testSubjects.click(formStepNextButton);

        await retry.waitFor('add remote cluster button to be rendered', async () => {
          return testSubjects.isDisplayed(addRemoteClusterButton);
        });

        await a11y.testAppSnapshot();
      });
    });

    const modes = ['sniff', 'proxy'];

    modes.forEach((mode: string) => {
      describe(`Edit remote cluster (${mode} mode)`, () => {
        const clusterName = mode === 'sniff' ? 'clusterSniffMode' : 'clusterProxyMode';
        const settings =
          mode === 'sniff'
            ? getPayloadClusterSniffMode(clusterName)
            : getPayloadClusterProxyMode(clusterName);

        beforeEach(async () => {
          await PageObjects.common.navigateToApp('remoteClusters');
        });

        before(async () => {
          await esClient.cluster.putSettings(settings);
        });

        after(async () => {
          await esClient.cluster.putSettings(getDeleteClusterPayload(clusterName));
        });

        it('renders the list view with remote clusters', async () => {
          await retry.waitFor('remote clusters list to be rendered', async () => {
            return testSubjects.isDisplayed(nameLink);
          });
          await a11y.testAppSnapshot();
        });

        it(`renders remote cluster details flyout (${mode} mode)`, async () => {
          await retry.waitFor('remote clusters list to be rendered', async () => {
            return testSubjects.isDisplayed(nameLink);
          });

          await testSubjects.click(nameLink);

          await retry.waitFor('remote cluster details to be rendered', async () => {
            return (await testSubjects.getVisibleText(detailsTitle)) === clusterName;
          });

          await a11y.testAppSnapshot();
        });

        it(`renders delete cluster modal (${mode} mode)`, async () => {
          await retry.waitFor('remote clusters list to be rendered', async () => {
            return testSubjects.isDisplayed(nameLink);
          });

          await testSubjects.click(deleteButton);

          await retry.waitFor('delete cluster modal to be rendered', async () => {
            return (
              (await testSubjects.getVisibleText(deleteModalTitle)) ===
              `Remove remote cluster '${clusterName}'?`
            );
          });

          await a11y.testAppSnapshot();
        });

        it(`renders edit remote cluster form and request flyout (${mode} mode)`, async () => {
          await retry.waitFor('edit remote cluster button to be rendered', async () => {
            return testSubjects.isDisplayed(editButton);
          });

          await testSubjects.click(editButton);
          await retry.waitFor('edit remote cluster form to be rendered', async () => {
            return (await testSubjects.getVisibleText(pageTitle)) === 'Edit remote cluster';
          });

          await testSubjects.click(requestButton);
          await retry.waitFor('request flyout to be rendered', async () => {
            return (
              (await testSubjects.getVisibleText(requestTitle)) === `Request for '${clusterName}'`
            );
          });

          await a11y.testAppSnapshot();
        });
      });
    });
  });
}
