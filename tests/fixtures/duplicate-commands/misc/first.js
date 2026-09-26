import { createOfficerCommand } from '../../../../src/lib/command.js';

export default {
  data: createOfficerCommand('duplicate', 'First'),
  execute: () => Promise.resolve(),
};
