/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { savedObjectsClientMock } from '@kbn/core/server/mocks';

import omit from 'lodash/omit';

import type { AgentPolicy, Output, DownloadSource, PackageInfo } from '../../types';
import { createAppContextStartContractMock } from '../../mocks';

import { agentPolicyService } from '../agent_policy';
import { agentPolicyUpdateEventHandler } from '../agent_policy_update';
import { appContextService } from '../app_context';
import { getPackageInfo } from '../epm/packages';
import { getFleetServerHostsForAgentPolicy } from '../fleet_server_host';

import {
  generateFleetConfig,
  getBinarySourceSettings,
  getFullAgentPolicy,
  getFullMonitoringSettings,
  transformOutputToFullPolicyOutput,
  generateFleetServerOutputSSLConfig,
} from './full_agent_policy';
import { getMonitoringPermissions } from './monitoring_permissions';

jest.mock('../epm/packages');
jest.mock('../fleet_server_host');

const mockedGetElasticAgentMonitoringPermissions = getMonitoringPermissions as jest.Mock<
  ReturnType<typeof getMonitoringPermissions>
>;
const mockedAgentPolicyService = agentPolicyService as jest.Mocked<typeof agentPolicyService>;

const soClientMock = savedObjectsClientMock.create();
const mockedGetPackageInfo = getPackageInfo as jest.Mock<ReturnType<typeof getPackageInfo>>;
const mockedGetFleetServerHostsForAgentPolicy = getFleetServerHostsForAgentPolicy as jest.Mock<
  ReturnType<typeof getFleetServerHostsForAgentPolicy>
>;

function mockAgentPolicy(data: Partial<AgentPolicy>) {
  mockedAgentPolicyService.get.mockResolvedValue({
    id: 'agent-policy',
    status: 'active',
    package_policies: [],
    is_managed: false,
    namespace: 'default',
    revision: 1,
    name: 'Policy',
    updated_at: '2020-01-01',
    updated_by: 'qwerty',
    is_protected: false,
    ...data,
  });
}

jest.mock('../agent_policy');

jest.mock('../output', () => {
  const OUTPUTS: { [k: string]: Output } = {
    'data-output-id': {
      id: 'data-output-id',
      is_default: false,
      is_default_monitoring: false,
      name: 'Data output',
      // @ts-ignore
      type: 'elasticsearch',
      hosts: ['http://es-data.co:9201'],
    },
    'monitoring-output-id': {
      id: 'monitoring-output-id',
      is_default: false,
      is_default_monitoring: false,
      name: 'Monitoring output',
      // @ts-ignore
      type: 'elasticsearch',
      hosts: ['http://es-monitoring.co:9201'],
    },
    'test-id': {
      id: 'test-id',
      is_default: true,
      is_default_monitoring: true,
      name: 'default',
      // @ts-ignore
      type: 'elasticsearch',
      hosts: ['http://127.0.0.1:9201'],
    },
    'test-remote-id': {
      id: 'test-remote-id',
      is_default: true,
      is_default_monitoring: true,
      name: 'default',
      // @ts-ignore
      type: 'remote_elasticsearch',
      hosts: ['http://127.0.0.1:9201'],
    },
  };
  return {
    outputService: {
      getDefaultDataOutputId: async () => 'test-id',
      getDefaultMonitoringOutputId: async () => 'test-id',
      get: (soClient: any, id: string): Output => OUTPUTS[id] || OUTPUTS['test-id'],
      bulkGet: async (ids: string[]): Promise<Output[]> => {
        return ids.map((id) => OUTPUTS[id] || OUTPUTS['test-id']);
      },
    },
  };
});

jest.mock('../agent_policy_update');
jest.mock('../agents');
jest.mock('../package_policy');

jest.mock('./monitoring_permissions');

jest.mock('../download_source', () => {
  return {
    downloadSourceService: {
      getDefaultDownloadSourceId: async () => 'default-download-source-id',
      get: async (soClient: any, id: string): Promise<DownloadSource> => {
        if (id === 'test-ds-1') {
          return {
            id: 'test-ds-1',
            is_default: false,
            name: 'Test',
            host: 'http://custom-registry-test',
            ssl: {
              certificate: 'cert',
              certificate_authorities: ['ca'],
              key: 'KEY1',
            },
          };
        } else if (id === 'test-ds-secrets') {
          return {
            id: 'test-ds-1',
            is_default: false,
            name: 'Test',
            host: 'http://custom-registry-test',
            secrets: {
              ssl: {
                key: 'KEY1',
              },
            },
          };
        }
        return {
          id: 'default-download-source-id',
          is_default: true,
          name: 'Default host',
          host: 'http://default-registry.co',
        };
      },
    },
  };
});

function getAgentPolicyUpdateMock() {
  return agentPolicyUpdateEventHandler as unknown as jest.Mock<
    typeof agentPolicyUpdateEventHandler
  >;
}

describe('getFullAgentPolicy', () => {
  beforeEach(() => {
    mockedGetFleetServerHostsForAgentPolicy.mockResolvedValue({
      name: 'default Fleet Server',
      id: '93f74c0-e876-11ea-b7d3-8b2acec6f75c',
      is_default: true,
      host_urls: ['http://fleetserver:8220'],
      is_preconfigured: false,
    });

    getAgentPolicyUpdateMock().mockClear();
    mockedAgentPolicyService.get.mockReset();
    mockedGetElasticAgentMonitoringPermissions.mockReset();
    mockedGetElasticAgentMonitoringPermissions.mockImplementation(
      async (soClient, { logs, metrics }, namespace) => {
        const names: string[] = [];
        if (logs) {
          names.push(`logs-${namespace}`);
        }
        if (metrics) {
          names.push(`metrics-${namespace}`);
        }

        return {
          _elastic_agent_monitoring: {
            indices: [
              {
                names,
                privileges: [],
              },
            ],
          },
        };
      }
    );
    soClientMock.find.mockResolvedValue({
      saved_objects: [
        {
          id: 'default-download-source-id',
          is_default: true,
          attributes: {
            download_source_id: 'test-source-id',
          },
        },
        {
          id: 'test-ds-1',
          attributes: {
            download_source_id: 'test-ds-1',
          },
        },
      ],
    } as any);
  });

  it('should return a policy without monitoring if monitoring is not enabled', async () => {
    mockAgentPolicy({
      revision: 1,
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        monitoring: {
          enabled: false,
          logs: false,
          metrics: false,
          traces: false,
        },
      },
    });
  });

  it('should return a policy with monitoring if monitoring is enabled for logs', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['logs'],
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        download: {
          sourceURI: 'http://default-registry.co',
        },
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: true,
          metrics: false,
          traces: false,
        },
      },
    });
  });

  it('should return a policy with monitoring if monitoring is enabled for metrics', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        download: {
          sourceURI: 'http://default-registry.co',
        },
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: false,
          metrics: true,
          traces: false,
        },
      },
    });
  });

  it('should return a policy with monitoring if monitoring is enabled for traces', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['traces'],
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        download: {
          sourceURI: 'http://default-registry.co',
        },
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: false,
          metrics: false,
          traces: true,
        },
      },
    });
  });

  it('should return a policy with monitoring enabled but no logs/metrics/traces if keep_monitoring_alive is true', async () => {
    mockAgentPolicy({
      keep_monitoring_alive: true,
    });

    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy?.agent?.monitoring).toEqual({
      enabled: true,
      logs: false,
      metrics: false,
      traces: false,
    });
  });

  it('should get the permissions for monitoring', async () => {
    mockAgentPolicy({
      namespace: 'testnamespace',
      revision: 1,
      monitoring_enabled: ['metrics'],
    });
    await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(mockedGetElasticAgentMonitoringPermissions).toHaveBeenCalledWith(
      expect.anything(),
      {
        logs: false,
        metrics: true,
        traces: false,
      },
      'testnamespace'
    );
  });

  it('should support a different monitoring output', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      monitoring_output_id: 'monitoring-output-id',
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchSnapshot();
  });

  it('should support a different data output', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      data_output_id: 'data-output-id',
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchSnapshot();
  });

  it('should support both different outputs for data and monitoring ', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      data_output_id: 'data-output-id',
      monitoring_output_id: 'monitoring-output-id',
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchSnapshot();
  });

  it('should use "default" as the default policy id', async () => {
    mockAgentPolicy({
      id: 'policy',
      status: 'active',
      package_policies: [],
      is_managed: false,
      namespace: 'default',
      revision: 1,
      data_output_id: 'test-id',
      monitoring_output_id: 'test-id',
    });

    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy?.outputs.default).toBeDefined();
  });

  it('should use output id as the default policy id when remote elasticsearch', async () => {
    mockAgentPolicy({
      id: 'policy',
      status: 'active',
      package_policies: [],
      is_managed: false,
      namespace: 'default',
      revision: 1,
      data_output_id: 'test-remote-id',
      monitoring_output_id: 'test-remote-id',
    });

    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy?.outputs['test-remote-id']).toBeDefined();
  });

  it('should return the right outputs and permissions when package policies use their own outputs', async () => {
    mockedGetPackageInfo.mockResolvedValue({
      data_streams: [
        {
          type: 'logs',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'logs',
          dataset: 'elastic_agent.filebeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.filebeat',
        },
      ],
    } as PackageInfo);
    mockAgentPolicy({
      id: 'integration-output-policy',
      status: 'active',
      package_policies: [
        {
          id: 'package-policy-using-output',
          name: 'test-policy-1',
          namespace: 'policyspace',
          enabled: true,
          package: { name: 'test_package', version: '0.0.0', title: 'Test Package' },
          output_id: 'test-remote-id',
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
        {
          id: 'package-policy-no-output',
          name: 'test-policy-2',
          namespace: '',
          enabled: true,
          package: { name: 'system', version: '1.0.0', title: 'System' },
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
      ],
      is_managed: false,
      namespace: 'defaultspace',
      revision: 1,
      name: 'Policy',
      updated_at: '2020-01-01',
      updated_by: 'qwerty',
      is_protected: false,
      data_output_id: 'data-output-id',
    });

    const agentPolicy = await getFullAgentPolicy(
      savedObjectsClientMock.create(),
      'integration-output-policy'
    );
    expect(agentPolicy).toMatchSnapshot();
  });

  it('should return the right outputs and permissions when package policies use their own outputs (with default output)', async () => {
    mockedGetPackageInfo.mockResolvedValue({
      data_streams: [
        {
          type: 'logs',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'logs',
          dataset: 'elastic_agent.filebeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.filebeat',
        },
      ],
    } as PackageInfo);
    mockAgentPolicy({
      id: 'integration-output-policy',
      status: 'active',
      package_policies: [
        {
          id: 'package-policy-using-output',
          name: 'test-policy-1',
          namespace: 'policyspace',
          enabled: true,
          package: { name: 'test_package', version: '0.0.0', title: 'Test Package' },
          output_id: 'test-id',
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
        {
          id: 'package-policy-no-output',
          name: 'test-policy-2',
          namespace: '',
          enabled: true,
          package: { name: 'system', version: '1.0.0', title: 'System' },
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
      ],
      is_managed: false,
      namespace: 'defaultspace',
      revision: 1,
      name: 'Policy',
      updated_at: '2020-01-01',
      updated_by: 'qwerty',
      is_protected: false,
      data_output_id: 'data-output-id',
    });

    const agentPolicy = await getFullAgentPolicy(
      savedObjectsClientMock.create(),
      'integration-output-policy'
    );
    expect(agentPolicy).toMatchSnapshot();
  });

  it('should return agent binary sourceURI and ssl options from the agent policy', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      download_source_id: 'test-ds-1',
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        download: {
          sourceURI: 'http://custom-registry-test',
          ssl: {
            certificate: 'cert',
            certificate_authorities: ['ca'],
            key: 'KEY1',
          },
        },
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: false,
          metrics: true,
          traces: false,
        },
      },
    });
  });
  it('should return agent binary with secrets if there are any present', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      download_source_id: 'test-ds-secrets',
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        download: {
          sourceURI: 'http://custom-registry-test',
          secrets: {
            ssl: {
              key: 'KEY1',
            },
          },
        },
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: false,
          metrics: true,
          traces: false,
        },
      },
    });
  });

  it('should add + transform agent features', async () => {
    mockAgentPolicy({
      namespace: 'default',
      revision: 1,
      monitoring_enabled: ['metrics'],
      agent_features: [
        { name: 'fqdn', enabled: true },
        { name: 'feature2', enabled: true },
      ],
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      outputs: {
        default: {
          type: 'elasticsearch',
          hosts: ['http://127.0.0.1:9201'],
        },
      },
      inputs: [],
      revision: 1,
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      agent: {
        monitoring: {
          namespace: 'default',
          use_output: 'default',
          enabled: true,
          logs: false,
          metrics: true,
          traces: false,
        },
        features: {
          fqdn: {
            enabled: true,
          },
          feature2: {
            enabled: true,
          },
        },
      },
    });
  });

  it('should populate agent.protection and signed properties if encryption is available', async () => {
    appContextService.start(createAppContextStartContractMock());

    mockAgentPolicy({});
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy!.agent!.protection).toMatchObject({
      enabled: false,
      uninstall_token_hash: '',
      signing_key: 'thisisapublickey',
    });
    expect(agentPolicy!.signed).toMatchObject({
      data: 'eyJpZCI6ImFnZW50LXBvbGljeSIsImFnZW50Ijp7ImZlYXR1cmVzIjp7fSwicHJvdGVjdGlvbiI6eyJlbmFibGVkIjpmYWxzZSwidW5pbnN0YWxsX3Rva2VuX2hhc2giOiIiLCJzaWduaW5nX2tleSI6InRoaXNpc2FwdWJsaWNrZXkifX0sImlucHV0cyI6W119',
      signature: 'thisisasignature',
    });
  });

  it('should not populate agent.protection and signed properties for standalone policies', async () => {
    appContextService.start(createAppContextStartContractMock());

    mockAgentPolicy({});
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy', {
      standalone: true,
    });

    expect(agentPolicy!.agent!.protection).toBeUndefined();
    expect(agentPolicy!.signed).toBeUndefined();
  });

  it('should compile full policy with correct namespaces', async () => {
    mockedGetPackageInfo.mockResolvedValue({
      data_streams: [
        {
          type: 'logs',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.metricbeat',
        },
        {
          type: 'logs',
          dataset: 'elastic_agent.filebeat',
        },
        {
          type: 'metrics',
          dataset: 'elastic_agent.filebeat',
        },
      ],
    } as PackageInfo);
    mockAgentPolicy({
      id: 'agent-policy',
      status: 'active',
      package_policies: [
        {
          id: 'package-policy-uuid-test-123',
          name: 'test-policy-1',
          namespace: 'policyspace',
          enabled: true,
          package: { name: 'test_package', version: '0.0.0', title: 'Test Package' },
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
        {
          id: 'package-policy-uuid-test-123',
          name: 'test-policy-2',
          namespace: '',
          enabled: true,
          package: { name: 'test_package', version: '0.0.0', title: 'Test Package' },
          inputs: [
            {
              type: 'test-logs',
              enabled: true,
              streams: [
                {
                  id: 'test-logs',
                  enabled: true,
                  data_stream: { type: 'logs', dataset: 'some-logs' },
                },
              ],
            },
            {
              type: 'test-metrics',
              enabled: false,
              streams: [
                {
                  id: 'test-logs',
                  enabled: false,
                  data_stream: { type: 'metrics', dataset: 'some-metrics' },
                },
              ],
            },
          ],
          created_at: '',
          updated_at: '',
          created_by: '',
          updated_by: '',
          revision: 1,
          policy_id: '',
          policy_ids: [''],
        },
      ],
      is_managed: false,
      namespace: 'defaultspace',
      revision: 1,
      name: 'Policy',
      updated_at: '2020-01-01',
      updated_by: 'qwerty',
      is_protected: false,
    });

    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(omit(agentPolicy, 'signed', 'secret_references', 'agent.protection')).toEqual({
      agent: {
        download: {
          sourceURI: 'http://default-registry.co',
        },
        features: {},
        monitoring: {
          enabled: false,
          logs: false,
          metrics: false,
          traces: false,
        },
      },
      fleet: {
        hosts: ['http://fleetserver:8220'],
      },
      id: 'agent-policy',
      inputs: [
        {
          data_stream: {
            namespace: 'policyspace',
          },
          id: 'test-logs-package-policy-uuid-test-123',
          meta: {
            package: {
              name: 'test_package',
              version: '0.0.0',
            },
          },
          name: 'test-policy-1',
          package_policy_id: 'package-policy-uuid-test-123',
          revision: 1,
          streams: [
            {
              data_stream: {
                dataset: 'some-logs',
                type: 'logs',
              },
              id: 'test-logs',
            },
          ],
          type: 'test-logs',
          use_output: 'default',
        },
        {
          data_stream: {
            namespace: 'defaultspace',
          },
          id: 'test-logs-package-policy-uuid-test-123',
          meta: {
            package: {
              name: 'test_package',
              version: '0.0.0',
            },
          },
          name: 'test-policy-2',
          package_policy_id: 'package-policy-uuid-test-123',
          revision: 1,
          streams: [
            {
              data_stream: {
                dataset: 'some-logs',
                type: 'logs',
              },
              id: 'test-logs',
            },
          ],
          type: 'test-logs',
          use_output: 'default',
        },
      ],
      output_permissions: {
        default: {
          _elastic_agent_checks: {
            cluster: ['monitor'],
          },
          _elastic_agent_monitoring: {
            indices: [
              {
                names: [],
                privileges: [],
              },
            ],
          },
          'package-policy-uuid-test-123': {
            indices: [
              {
                names: ['logs-some-logs-defaultspace'],
                privileges: ['auto_configure', 'create_doc'],
              },
            ],
          },
        },
      },
      outputs: {
        default: {
          hosts: ['http://127.0.0.1:9201'],
          preset: 'balanced',
          type: 'elasticsearch',
        },
      },
      revision: 1,
    });
  });

  it('should return a policy with advanced settings', async () => {
    mockAgentPolicy({
      advanced_settings: {
        agent_limits_go_max_procs: 2,
        agent_logging_level: 'debug',
        agent_logging_to_files: true,
        agent_logging_files_rotateeverybytes: 10000,
        agent_logging_files_keepfiles: 10,
        agent_logging_files_interval: '7h',
      },
    });
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');

    expect(agentPolicy).toMatchObject({
      id: 'agent-policy',
      agent: {
        limits: { go_max_procs: 2 },
        logging: {
          level: 'debug',
          to_files: true,
          files: { rotateeverybytes: 10000, keepfiles: 10, interval: '7h' },
        },
      },
    });
  });

  it('should have ssl options in outputs when fleet server host has es ssl options', async () => {
    mockedGetFleetServerHostsForAgentPolicy.mockResolvedValue({
      name: 'default Fleet Server',
      id: '93f74c0-e876-11ea-b7d3-8b2acec6f75c',
      is_default: true,
      host_urls: ['http://fleetserver:8220'],
      is_preconfigured: false,
      ssl: {
        certificate_authorities: ['/tmp/ssl/ca.crt'],
        certificate: 'my-cert',
        key: 'my-key',
        es_certificate_authorities: ['/tmp/ssl/es-ca.crt'],
        es_certificate: 'my-es-cert',
        es_key: 'my-es-key',
      },
    });

    mockAgentPolicy({});
    const agentPolicy = await getFullAgentPolicy(savedObjectsClientMock.create(), 'agent-policy');
    expect(agentPolicy?.outputs).toMatchObject({
      default: {
        hosts: ['http://127.0.0.1:9201'],
        preset: 'balanced',
        type: 'elasticsearch',
      },
      'fleetserver-output-93f74c0-e876-11ea-b7d3-8b2acec6f75c': {
        ssl: {
          certificate: 'my-es-cert',
          certificate_authorities: ['/tmp/ssl/es-ca.crt'],
          key: 'my-es-key',
        },
        type: 'elasticsearch',
      },
    });
  });
});

describe('getFullMonitoringSettings', () => {
  it('should return the correct settings when all values are present', async () => {
    const monitoringSettings = getFullMonitoringSettings(
      {
        namespace: 'default',
        monitoring_enabled: ['metrics', 'logs', 'traces'],
        monitoring_pprof_enabled: true,
        monitoring_http: {
          enabled: true,
          host: 'localhost',
          port: 1111,
        },
        monitoring_diagnostics: {
          limit: {
            interval: '1m',
            burst: 10,
          },
          uploader: {
            max_retries: 3,
            init_dur: '1m',
            max_dur: '10m',
          },
        },
      },
      {
        id: 'some-output',
        is_default: false,
        type: 'elasticsearch',
      }
    );

    expect(monitoringSettings).toEqual({
      enabled: true,
      logs: true,
      metrics: true,
      traces: true,
      namespace: 'default',
      use_output: 'some-output',
      pprof: { enabled: true },
      http: {
        enabled: true,
        host: 'localhost',
        port: 1111,
      },
      diagnostics: {
        limit: {
          interval: '1m',
          burst: 10,
        },
        uploader: {
          max_retries: 3,
          init_dur: '1m',
          max_dur: '10m',
        },
      },
    });
  });

  it('should return the correct settings when some values are present', async () => {
    const monitoringSettings = getFullMonitoringSettings(
      {
        namespace: 'default',
        monitoring_enabled: ['metrics'],
        monitoring_pprof_enabled: false,
        monitoring_http: {
          enabled: true,
          host: 'localhost',
        },
        monitoring_diagnostics: {
          limit: {
            interval: '1m',
          },
          uploader: {
            max_dur: '10m',
          },
        },
      },
      {
        id: 'some-output',
        is_default: true,
        type: 'elasticsearch',
      }
    );

    expect(monitoringSettings).toEqual({
      enabled: true,
      logs: false,
      metrics: true,
      traces: false,
      namespace: 'default',
      use_output: 'default',
      pprof: { enabled: false },
      http: {
        enabled: true,
        host: 'localhost',
      },
      diagnostics: {
        limit: {
          interval: '1m',
        },
        uploader: {
          max_dur: '10m',
        },
      },
    });
  });

  it('should return the correct settings when beats monitoring is disabled and minimal values are present', async () => {
    const monitoringSettings = getFullMonitoringSettings(
      {
        namespace: 'default',
        monitoring_enabled: [],
        monitoring_http: {
          enabled: true,
        },
        monitoring_diagnostics: {},
      },
      {
        id: 'some-output',
        is_default: true,
        type: 'elasticsearch',
      }
    );

    expect(monitoringSettings).toEqual({
      enabled: true,
      logs: false,
      metrics: false,
      traces: false,
      http: {
        enabled: true,
      },
    });
  });

  it('should disable monitoring if beats and http monitoring are disabled', async () => {
    const monitoringSettings = getFullMonitoringSettings(
      {
        namespace: 'default',
        monitoring_enabled: [],
        monitoring_http: {
          enabled: false,
        },
        monitoring_diagnostics: {},
      },
      {
        id: 'some-output',
        is_default: true,
        type: 'elasticsearch',
      }
    );

    expect(monitoringSettings).toEqual({
      enabled: false,
      logs: false,
      metrics: false,
      traces: false,
    });
  });
});

describe('transformOutputToFullPolicyOutput', () => {
  it('should works with only required field on a output', () => {
    const policyOutput = transformOutputToFullPolicyOutput({
      id: 'id123',
      hosts: ['http://host.fr'],
      is_default: false,
      is_default_monitoring: false,
      name: 'test output',
      type: 'elasticsearch',
    });

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "http://host.fr",
        ],
        "preset": "balanced",
        "type": "elasticsearch",
      }
    `);
  });
  it('should support ca_trusted_fingerprint field on a output', () => {
    const policyOutput = transformOutputToFullPolicyOutput({
      id: 'id123',
      hosts: ['http://host.fr'],
      is_default: false,
      is_default_monitoring: false,
      name: 'test output',
      type: 'elasticsearch',
      ca_trusted_fingerprint: 'fingerprint123',
      config_yaml: `
test: 1234
ssl.test: 123
      `,
    });

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "http://host.fr",
        ],
        "preset": "balanced",
        "ssl.ca_trusted_fingerprint": "fingerprint123",
        "ssl.test": 123,
        "test": 1234,
        "type": "elasticsearch",
      }
    `);
  });

  it('should works with proxy', () => {
    const policyOutput = transformOutputToFullPolicyOutput(
      {
        id: 'id123',
        hosts: ['http://host.fr'],
        is_default: false,
        is_default_monitoring: false,
        name: 'test output',
        type: 'elasticsearch',
        proxy_id: 'proxy-1',
      },
      {
        id: 'proxy-1',
        name: 'Proxy 1',
        url: 'https://proxy1.fr',
        is_preconfigured: false,
      }
    );

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "http://host.fr",
        ],
        "preset": "balanced",
        "proxy_url": "https://proxy1.fr",
        "type": "elasticsearch",
      }
    `);
  });

  it('should return placeholder API_KEY for elasticsearch output type in standalone ', () => {
    const policyOutput = transformOutputToFullPolicyOutput(
      {
        id: 'id123',
        hosts: ['http://host.fr'],
        is_default: false,
        is_default_monitoring: false,
        name: 'test output',
        type: 'elasticsearch',
      },
      undefined,
      true
    );

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "api_key": "\${API_KEY}",
        "hosts": Array [
          "http://host.fr",
        ],
        "preset": "balanced",
        "type": "elasticsearch",
      }
    `);
  });

  it('should not return placeholder API_KEY for logstash output type in standalone ', () => {
    const policyOutput = transformOutputToFullPolicyOutput(
      {
        id: 'id123',
        hosts: ['host.fr:3332'],
        is_default: false,
        is_default_monitoring: false,
        name: 'test output',
        type: 'logstash',
      },
      undefined,
      false
    );

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "host.fr:3332",
        ],
        "type": "logstash",
      }
    `);
  });

  it('should not override advanced yaml ssl fields for logstash output type', () => {
    const policyOutput = transformOutputToFullPolicyOutput(
      {
        id: 'id123',
        hosts: ['host.fr:3332'],
        is_default: false,
        is_default_monitoring: false,
        name: 'test output',
        type: 'logstash',
        config_yaml: 'ssl:\n  verification_mode: "none" ',
        ssl: {
          certificate: '',
          certificate_authorities: [],
        },
      },
      undefined,
      false
    );

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "host.fr:3332",
        ],
        "ssl": Object {
          "certificate": "",
          "certificate_authorities": Array [],
          "verification_mode": "none",
        },
        "type": "logstash",
      }
    `);
  });

  it('should work with kafka output', () => {
    const policyOutput = transformOutputToFullPolicyOutput({
      id: 'id123',
      hosts: ['test:9999'],
      topic: 'test',
      is_default: false,
      is_default_monitoring: false,
      name: 'test output',
      type: 'kafka',
      config_yaml: '',
      client_id: 'Elastic',
      version: '1.0.0',
      compression: 'none',
      auth_type: 'none',
      connection_type: 'plaintext',
      partition: 'random',
      random: {
        group_events: 1,
      },
      headers: [
        {
          key: '',
          value: '',
        },
      ],
      timeout: 30,
      broker_timeout: 30,
      required_acks: 1,
    });

    expect(policyOutput).toMatchInlineSnapshot(`
      Object {
        "broker_timeout": 30,
        "client_id": "Elastic",
        "compression": "none",
        "headers": Array [],
        "hosts": Array [
          "test:9999",
        ],
        "key": undefined,
        "partition": Object {
          "random": Object {
            "group_events": 1,
          },
        },
        "required_acks": 1,
        "timeout": 30,
        "topic": "test",
        "type": "kafka",
        "version": "1.0.0",
      }
    `);
  });
});

describe('generateFleetConfig', () => {
  const agentPolicy = {
    id: 'agent-policy',
    status: 'active',
    package_policies: [],
    is_managed: false,
    namespace: 'default',
    revision: 1,
    name: 'Policy',
    updated_at: '2020-01-01',
    updated_by: 'qwerty',
    is_protected: false,
  } as any;

  it('should work without proxy', () => {
    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [],
      []
    );

    expect(res).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "https://test.fr",
        ],
      }
    `);
  });

  it('should work with proxy', () => {
    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
        proxy_id: 'proxy-1',
      } as any,
      [
        {
          id: 'proxy-1',
          url: 'https://proxy.fr',
        } as any,
      ],
      []
    );

    expect(res).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "https://test.fr",
        ],
        "proxy_url": "https://proxy.fr",
      }
    `);
  });

  it('should work with proxy with headers and certificate authorities', () => {
    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
        proxy_id: 'proxy-1',
      } as any,
      [
        {
          id: 'proxy-1',
          url: 'https://proxy.fr',
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          proxy_headers: { Authorization: 'xxx' },
        } as any,
      ],
      []
    );

    expect(res).toMatchInlineSnapshot(`
      Object {
        "hosts": Array [
          "https://test.fr",
        ],
        "proxy_headers": Object {
          "Authorization": "xxx",
        },
        "proxy_url": "https://proxy.fr",
        "ssl": Object {
          "certificate_authorities": Array [
            Array [
              "/tmp/ssl/ca.crt",
            ],
          ],
          "renegotiation": "never",
          "verification_mode": "",
        },
      }
    `);
  });

  it('should work with proxy with headers and certificate authorities and certificate and key', () => {
    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
        proxy_id: 'proxy-1',
      } as any,
      [
        {
          id: 'proxy-1',
          url: 'https://proxy.fr',
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          proxy_headers: { Authorization: 'xxx' },
          certificate: 'my-cert',
          certificate_key: 'my-key',
        } as any,
      ],
      []
    );

    expect(res).toMatchInlineSnapshot(`
    Object {
      "hosts": Array [
        "https://test.fr",
      ],
      "proxy_headers": Object {
        "Authorization": "xxx",
      },
      "proxy_url": "https://proxy.fr",
      "ssl": Object {
        "certificate": "my-cert",
        "certificate_authorities": Array [
          Array [
            "/tmp/ssl/ca.crt",
          ],
        ],
        "key": "my-key",
        "renegotiation": "never",
        "verification_mode": "",
      },
    }
  `);
  });

  it('should generate ssl config when a default ES output has ssl options', () => {
    const outputs = [
      {
        id: 'output-1',
        name: 'Output 1',
        type: 'elasticsearch',
        is_default_monitoring: true,
        is_default: true,
        hosts: ['http://test.fr:9200'],
        ssl: {
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          certificate: 'my-cert',
          key: 'my-key',
        },
      },
      {
        id: 'output-2',
        name: 'Output 2',
        type: 'remote_elasticsearch',
        is_default_monitoring: false,
        hosts: ['http://test.fr:9200'],
        is_default: false,
      },
    ] as any;

    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [], // no proxies
      outputs
    );

    expect(res).toEqual({
      hosts: ['https://test.fr'],
      ssl: {
        certificate: 'my-cert',
        certificate_authorities: ['/tmp/ssl/ca.crt'],
        key: 'my-key',
      },
    });
  });

  it('should generate ssl config when a default remote_elasticsearch output has ssl options', () => {
    const outputs = [
      {
        id: 'output-1',
        name: 'Output 1',
        type: 'remote_elasticsearch',
        is_default_monitoring: true,
        is_default: true,
        hosts: ['http://test.fr:9200'],
        ssl: {
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          certificate: 'my-cert',
          key: 'my-key',
        },
        secrets: {
          service_token: { id: 'my-service-token' },
        },
      },
      {
        id: 'output-2',
        name: 'Output 2',
        type: 'remote_elasticsearch',
        is_default_monitoring: false,
        hosts: ['http://test.fr:9200'],
        is_default: false,
      },
    ] as any;

    const res = generateFleetConfig(
      agentPolicy,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [], // no proxies
      outputs
    );

    expect(res).toEqual({
      hosts: ['https://test.fr'],
      ssl: {
        certificate: 'my-cert',
        certificate_authorities: ['/tmp/ssl/ca.crt'],
        key: 'my-key',
      },
      secrets: {
        service_token: { id: 'my-service-token' },
      },
    });
  });

  it('should generate ssl config when a ES custom output has ssl options', () => {
    const outputs = [
      {
        id: 'output-1',
        name: 'Output 1',
        type: 'elasticsearch',
        is_default: true,
        hosts: ['http://test.fr:9200'],
      },
      {
        id: 'output-2',
        name: 'Output 2',
        type: 'elasticsearch',
        is_default_monitoring: false,
        hosts: ['http://test.fr:9200'],
        is_default: false,
        ssl: {
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          certificate: 'my-cert',
        },
        secrets: {
          ssl: {
            key: { id: 'my-key' },
          },
        },
      },
    ] as any;

    const agentPolicyWithCustomOutput = { ...agentPolicy, data_output_id: 'output-2' };
    const res = generateFleetConfig(
      agentPolicyWithCustomOutput,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [], // no proxies
      outputs
    );

    expect(res).toEqual({
      hosts: ['https://test.fr'],
      secrets: {
        ssl: {
          key: { id: 'my-key' },
        },
      },
      ssl: {
        certificate: 'my-cert',
        certificate_authorities: ['/tmp/ssl/ca.crt'],
      },
    });
  });

  it('should generate ssl config when a remote_elasticsearch custom output has ssl options', () => {
    const outputs = [
      {
        id: 'output-1',
        name: 'Output 1',
        type: 'elasticsearch',
        is_default: true,
        hosts: ['http://test.fr:9200'],
      },
      {
        id: 'output-2',
        name: 'Output 2',
        type: 'remote_elasticsearch',
        is_default_monitoring: false,
        hosts: ['http://test.fr:9200'],
        is_default: false,
        ssl: {
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          certificate: 'my-cert',
        },
        secrets: {
          ssl: {
            key: { id: 'my-key' },
          },
        },
      },
    ] as any;

    const agentPolicyWithCustomOutput = { ...agentPolicy, data_output_id: 'output-2' };
    const res = generateFleetConfig(
      agentPolicyWithCustomOutput,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [], // no proxies
      outputs
    );

    expect(res).toEqual({
      hosts: ['https://test.fr'],
      secrets: {
        ssl: {
          key: {
            id: 'my-key',
          },
        },
      },
      ssl: {
        certificate: 'my-cert',
        certificate_authorities: ['/tmp/ssl/ca.crt'],
      },
    });
  });

  it('should use secrets key if both keys are present', () => {
    const outputs = [
      {
        id: 'output-1',
        name: 'Output 1',
        type: 'elasticsearch',
        is_default: true,
        hosts: ['http://test.fr:9200'],
      },
      {
        id: 'output-2',
        name: 'Output 2',
        type: 'remote_elasticsearch',
        is_default_monitoring: false,
        hosts: ['http://test.fr:9200'],
        is_default: false,
        ssl: {
          certificate_authorities: ['/tmp/ssl/ca.crt'],
          certificate: 'my-cert',
          key: { id: 'my-key' },
        },
        secrets: {
          ssl: {
            key: { id: 'my-secret-key' },
          },
          service_token: { id: 'my-service-token' },
        },
      },
    ] as any;

    const agentPolicyWithCustomOutput = { ...agentPolicy, data_output_id: 'output-2' };
    const res = generateFleetConfig(
      agentPolicyWithCustomOutput,
      {
        host_urls: ['https://test.fr'],
      } as any,
      [],
      outputs
    );

    expect(res).toEqual({
      hosts: ['https://test.fr'],
      secrets: {
        ssl: {
          key: {
            id: 'my-secret-key',
          },
        },
        service_token: { id: 'my-service-token' },
      },
      ssl: {
        certificate: 'my-cert',
        certificate_authorities: ['/tmp/ssl/ca.crt'],
      },
    });
  });
});

describe('generateFleetServerOutputSSLConfig', () => {
  const baseFleetServerHost = {
    name: 'default Fleet Server',
    id: '93f74c0-e876-11ea-b7d3-8b2acec6f75c',
    is_default: true,
    host_urls: ['http://fleetserver:8220'],
    is_preconfigured: false,
  } as any;

  it('should return undefined if no fleetServerHost is passed', () => {
    const res = generateFleetServerOutputSSLConfig(undefined);
    expect(res).toEqual(undefined);
  });

  it('should return undefined if fleetServerHost has no ssl and no secrets', () => {
    const res = generateFleetServerOutputSSLConfig(baseFleetServerHost);
    expect(res).toEqual(undefined);
  });

  it('should generate a bootstrap output if there are ES ssl fields', () => {
    const fleetServerHost = {
      ...baseFleetServerHost,
      ssl: {
        certificate_authorities: ['/tmp/ssl/ca.crt'],
        certificate: 'my-cert',
        key: 'my-key',
        es_certificate_authorities: ['/tmp/ssl/es-ca.crt'],
        es_certificate: 'my-es-cert',
        es_key: 'my-es-key',
      },
    };
    const res = generateFleetServerOutputSSLConfig(fleetServerHost);
    expect(res).toEqual({
      'fleetserver-output-93f74c0-e876-11ea-b7d3-8b2acec6f75c': {
        ssl: {
          certificate: 'my-es-cert',
          certificate_authorities: ['/tmp/ssl/es-ca.crt'],
          key: 'my-es-key',
        },
        type: 'elasticsearch',
      },
    });
  });

  it('should generate a bootstrap output if there are ES secrets fields', () => {
    const fleetServerHost = {
      ...baseFleetServerHost,
      secrets: {
        ssl: {
          key: 'my-key',
          es_key: 'my-es-key',
        },
      },
    };
    const res = generateFleetServerOutputSSLConfig(fleetServerHost);
    expect(res).toEqual({
      'fleetserver-output-93f74c0-e876-11ea-b7d3-8b2acec6f75c': {
        secrets: {
          ssl: {
            key: 'my-es-key',
          },
        },
        type: 'elasticsearch',
      },
    });
  });

  it('should generate a bootstrap output if there are both secrets and ES ssl fields', () => {
    const fleetServerHost = {
      ...baseFleetServerHost,
      ssl: {
        es_certificate_authorities: ['/tmp/ssl/es-ca.crt'],
        es_certificate: 'my-es-cert',
      },
      secrets: {
        ssl: {
          key: { id: 'my-key' },
          es_key: { id: 'my-es-key' },
        },
      },
    };
    const res = generateFleetServerOutputSSLConfig(fleetServerHost);
    expect(res).toEqual({
      'fleetserver-output-93f74c0-e876-11ea-b7d3-8b2acec6f75c': {
        ssl: {
          certificate_authorities: ['/tmp/ssl/es-ca.crt'],
          certificate: 'my-es-cert',
        },
        secrets: {
          ssl: {
            key: { id: 'my-es-key' },
          },
        },
        type: 'elasticsearch',
      },
    });
  });
  it('should use secrets key if the key is present in both ways', () => {
    const fleetServerHost = {
      ...baseFleetServerHost,
      ssl: {
        es_certificate_authorities: ['/tmp/ssl/es-ca.crt'],
        es_certificate: 'my-es-cert',
        es_key: { id: 'my-es-key' },
      },
      secrets: {
        ssl: {
          key: { id: 'my-key' },
          es_key: { id: 'my-secret-es-key' },
        },
      },
    };
    const res = generateFleetServerOutputSSLConfig(fleetServerHost);
    expect(res).toEqual({
      'fleetserver-output-93f74c0-e876-11ea-b7d3-8b2acec6f75c': {
        ssl: {
          certificate_authorities: ['/tmp/ssl/es-ca.crt'],
          certificate: 'my-es-cert',
        },
        secrets: {
          ssl: {
            key: { id: 'my-secret-es-key' },
          },
        },
        type: 'elasticsearch',
      },
    });
  });
});

describe('getBinarySourceSettings', () => {
  const downloadSource = {
    id: 'test-ds-1',
    is_default: false,
    name: 'Test',
    host: 'http://custom-registry-test',
  } as any;

  it('should return sourceURI for agent download config', () => {
    expect(getBinarySourceSettings(downloadSource, null)).toEqual({
      sourceURI: 'http://custom-registry-test',
    });
  });

  it('should return agent download config with ssl options if present', () => {
    const downloadSourceSSL = {
      ...downloadSource,
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
        key: 'KEY1',
      },
    };
    expect(getBinarySourceSettings(downloadSourceSSL, null)).toEqual({
      sourceURI: 'http://custom-registry-test',
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
        key: 'KEY1',
      },
    });
  });

  it('should return agent download config when there is a proxy', () => {
    expect(getBinarySourceSettings(downloadSource, 'http://proxy_uri.it')).toEqual({
      proxy_url: 'http://proxy_uri.it',
      sourceURI: 'http://custom-registry-test',
    });
  });

  it('should return agent download config with secrets if present', () => {
    const downloadSourceSecrets = {
      ...downloadSource,
      secrets: {
        ssl: {
          key: { id: 'keyid' },
        },
      },
    };
    expect(getBinarySourceSettings(downloadSourceSecrets, null)).toEqual({
      sourceURI: 'http://custom-registry-test',
      secrets: {
        ssl: {
          key: { id: 'keyid' },
        },
      },
    });
  });

  it('should return agent download config with secrets and ssl if present', () => {
    const downloadSourceSecrets = {
      ...downloadSource,
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
      },
      secrets: {
        ssl: {
          key: { id: 'keyid' },
        },
      },
    };
    expect(getBinarySourceSettings(downloadSourceSecrets, null)).toEqual({
      sourceURI: 'http://custom-registry-test',
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
      },
      secrets: {
        ssl: {
          key: { id: 'keyid' },
        },
      },
    });
  });
  it('should return agent download config using secrets key if both keys are present', () => {
    const downloadSourceSecrets = {
      ...downloadSource,
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
        key: { id: 'keyid' },
      },
      secrets: {
        ssl: {
          key: { id: 'secretkeyid' },
        },
      },
    };
    expect(getBinarySourceSettings(downloadSourceSecrets, null)).toEqual({
      sourceURI: 'http://custom-registry-test',
      ssl: {
        certificate: 'cert',
        certificate_authorities: ['ca'],
      },
      secrets: {
        ssl: {
          key: { id: 'secretkeyid' },
        },
      },
    });
  });
});
