import { AuthClient } from '@dfinity/auth-client'
import { HttpAgent } from '@dfinity/agent'

export async function getAgent(auth?: AuthClient) {
  const identity = auth ? auth.getIdentity() : undefined
  const agent = new HttpAgent({ identity })
  // if (import.meta.env.DEV) await agent.fetchRootKey()
  return agent
}
