import { Events } from 'discord.js';
import { assignJoinRole } from '../handlers/joinRole.js';

// Needs the privileged GuildMembers intent, which the client already requests.
export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await assignJoinRole(member);
  },
};
