import { verifyNetworkRevisions } from '@domain/models/networkWatch'

// Every test runs with the revision of the networks checked against their content: a change made
// in place without `touchNetwork` throws where it is first read. The benches measure the editor as
// it runs, without the check.
if (import.meta.env.MODE !== 'benchmark') verifyNetworkRevisions(true)
