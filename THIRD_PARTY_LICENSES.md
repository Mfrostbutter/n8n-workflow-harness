# Third-party licenses

This harness redistributes and depends on the components below. Each is
reproduced here in full, as its license requires.

---

## n8n-mcp

The `n8n-docs` and `n8n` servers in `.mcp.json` run the `n8n-mcp` npm package
(pinned to 2.94.3 in `package.json`, installed by `npm ci`). It is not vendored
into this repository.

Upstream: https://github.com/czlonkowski/n8n-mcp

    MIT License
    
    Copyright (c) 2024 Romuald Czlonkowski @ www.aiadvisors.pl/en
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
---

## n8n-skills

Fifteen of the twenty-three skills under `.agents/skills/` are vendored, unmodified,
from the `n8n-skills` pack. See ATTRIBUTION.md for the exact list.

Upstream: https://github.com/czlonkowski/n8n-skills

    MIT License
    
    Copyright (c) 2025 Romuald Członkowski
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

---

## @n8n/cli and @n8n/workflow-sdk

`package.json` pins `@n8n/cli` (0.22.0) and `@n8n/workflow-sdk` (0.36.5),
installed by `npm ci` and not vendored. Both are published by n8n GmbH under
the Sustainable Use License, with the `@n8n/workflow-sdk` package also carrying
the n8n Enterprise License terms for enterprise features. Full text:
https://github.com/n8n-io/n8n/blob/master/LICENSE.md and
https://github.com/n8n-io/n8n/blob/master/LICENSE_EE.md. Use inside your own
organisation to build and promote your own workflows is within the license;
redistribution of either package as part of a product is not covered by this
harness and needs your own review.
