/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from 'expect';
import { log, timerange } from '@kbn/apm-synthtrace-client';
import moment from 'moment';
import { FtrProviderContext } from '../../../ftr_provider_context';

const CF_COMMAND_REGEXP =
  /aws cloudformation create-stack --stack-name (\S+) --template-url \S+ --parameters ParameterKey=FirehoseStreamName,ParameterValue=(\S+) .+? --capabilities CAPABILITY_IAM/;

export default function ({ getPageObjects, getService }: FtrProviderContext) {
  const PageObjects = getPageObjects(['common', 'svlCommonPage']);

  const browser = getService('browser');
  const testSubjects = getService('testSubjects');
  const synthtrace = getService('svlLogsSynthtraceClient');

  describe('Onboarding Firehose Quickstart Flow', () => {
    before(async () => {
      await PageObjects.svlCommonPage.loginAsAdmin(); // Onboarding requires admin role
      await PageObjects.common.navigateToUrlWithBrowserHistory(
        'observabilityOnboarding',
        '/firehose',
        undefined,
        {
          ensureCurrentUrl: false, // the check sometimes is too slow for the page so it misses the point in time before the app rewrites the URL
        }
      );
    });

    after(async () => {
      await synthtrace.clean();
    });

    beforeEach(async () => {
      await (await testSubjects.find('createCloudFormationOptionAWSCLI', 20000)).click();
      await testSubjects.existOrFail('observabilityOnboardingFirehoseCreateStackCommand');
    });

    it('shows the correct CloudFormation command snippet', async () => {
      await testSubjects.clickWhenNotDisabled('observabilityOnboardingCopyToClipboardButton');
      const copiedCommand = await browser.getClipboardValue();

      expect(copiedCommand).toMatch(CF_COMMAND_REGEXP);
    });

    it('starts to monitor for incoming data after user leaves the page', async () => {
      await browser.execute(`window.dispatchEvent(new Event("blur"))`);

      await testSubjects.isDisplayed('observabilityOnboardingFirehoseProgressCallout');
    });

    it('shows an AWS service when data is detected', async () => {
      const DATASET = 'aws.vpcflow';
      const AWS_SERVICE_ID = 'vpc-flow';
      await testSubjects.clickWhenNotDisabled('observabilityOnboardingCopyToClipboardButton');
      const copiedCommand = await browser.getClipboardValue();
      const [, _stackName, streamName] = copiedCommand.match(CF_COMMAND_REGEXP) ?? [];

      expect(streamName).toBeDefined();

      await browser.execute(`window.dispatchEvent(new Event("blur"))`);

      // Simulate Firehose stream ingesting log files
      const to = new Date().toISOString();
      const count = 1;
      await synthtrace.index(
        timerange(moment(to).subtract(count, 'minute'), moment(to))
          .interval('1m')
          .rate(1)
          .generator((timestamp) => {
            return log.create().dataset(DATASET).timestamp(timestamp).defaults({
              'aws.kinesis.name': streamName,
            });
          })
      );

      // Checking that an AWS service item is visible after data is detected
      await testSubjects.isDisplayed(`observabilityOnboardingAWSService-${AWS_SERVICE_ID}`);
    });

    it('shows the existing data callout and detected AWS services when data was ingested previously', async () => {
      const DATASET = 'aws.vpcflow';
      const AWS_SERVICE_ID = 'vpc-flow';
      await testSubjects.clickWhenNotDisabled('observabilityOnboardingCopyToClipboardButton');
      const copiedCommand = await browser.getClipboardValue();
      const [, _stackName, streamName] = copiedCommand.match(CF_COMMAND_REGEXP) ?? [];

      await testSubjects.missingOrFail('observabilityOnboardingFirehosePanelExistingDataCallout');

      expect(streamName).toBeDefined();

      // Simulate Firehose stream ingesting log files
      const to = new Date().toISOString();
      const count = 1;
      await synthtrace.index(
        timerange(moment(to).subtract(count, 'minute'), moment(to))
          .interval('1m')
          .rate(1)
          .generator((timestamp) => {
            return log.create().dataset(DATASET).timestamp(timestamp).defaults({
              'aws.kinesis.name': streamName,
            });
          })
      );

      await browser.refresh();

      // Checking that the existing data callout is visible after data is detected
      await testSubjects.isDisplayed('observabilityOnboardingFirehosePanelExistingDataCallout');

      // Checking that an AWS service item is visible after data is detected
      await testSubjects.isDisplayed(`observabilityOnboardingAWSService-${AWS_SERVICE_ID}`);
    });
  });
}
