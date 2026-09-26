import { createOfficerCommand } from '../../../../src/lib/command.js';

export default {
  data: createOfficerCommand('duplicate', 'Second'),
  execute: () => Promise.resolve(),
};
