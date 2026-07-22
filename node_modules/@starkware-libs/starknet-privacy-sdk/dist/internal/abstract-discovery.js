import { SetupRequirement } from "../interfaces.js";
export class AbstractDiscoveryProvider {
    // Default implementation provided by the abstract class
    async discoverRequirement(address, viewingKey, recipient, token) {
        const { channels } = await this.discoverChannels(address, viewingKey, [recipient]);
        const channel = channels?.get(recipient);
        return channel?.toSetupRequirement(token) ?? SetupRequirement.Register;
    }
}
//# sourceMappingURL=abstract-discovery.js.map