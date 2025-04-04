/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import expect from '@kbn/expect';
import { FtrProviderContext } from '../../ftr_provider_context';

export default function ({ getService, getPageObjects }: FtrProviderContext) {
  const kibanaServer = getService('kibanaServer');
  const browser = getService('browser');
  const retry = getService('retry');
  const find = getService('find');
  const PageObjects = getPageObjects(['common', 'home', 'settings', 'discover', 'header']);

  describe('data view field filters', function describeIndexTests() {
    before(async function () {
      await browser.setWindowSize(1200, 800);
      await kibanaServer.importExport.load(
        'src/platform/test/functional/fixtures/kbn_archiver/discover'
      );
    });

    after(async () => {
      await kibanaServer.importExport.unload(
        'src/platform/test/functional/fixtures/kbn_archiver/discover'
      );
    });

    it('can create field filter', async function () {
      await PageObjects.settings.navigateTo();
      await PageObjects.settings.clickKibanaIndexPatterns();
      await PageObjects.settings.clickIndexPatternLogstash();
      await PageObjects.settings.clickSourceFiltersTab();
      await PageObjects.header.waitUntilLoadingHasFinished();
      await PageObjects.settings.addFieldFilter('a');
      expect(parseInt(await PageObjects.settings.getFieldFilterTabCount(), 10)).to.be(1);
    });

    it('can modify a field filter', async function () {
      await PageObjects.settings.editFieldFilter('a', 'z');

      // reload page and verify change
      await PageObjects.settings.navigateTo();
      await PageObjects.settings.clickKibanaIndexPatterns();
      await PageObjects.settings.clickIndexPatternLogstash();
      await PageObjects.settings.clickSourceFiltersTab();

      const table = await find.byClassName('euiTable');
      await retry.waitFor('field filter that was changed', async () => {
        const tableCells = await table.findAllByCssSelector('td');
        const fieldNames = await Promise.all(
          tableCells.map(async (cell) => {
            return (await cell.getVisibleText()).trim();
          })
        );
        return fieldNames.includes('z');
      });
    });
  });
}
