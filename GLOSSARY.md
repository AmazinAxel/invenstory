# Invenstory

Stock and sales tracking for a small-business owner, run as automations on the owner's own n8n.

## Language

**Owner**:
The non-technical business person using the app; the only user.
_Avoid_: User, customer, admin

**Automation**:
A piece of work Invenstory runs in the owner's n8n, such as keeping stock in sync or updating a price. What the owner sees; an n8n workflow underneath.
_Avoid_: Workflow, flow, node (in anything the owner reads)

**Confirmation**:
A question the assistant puts to the owner before changing the owner's systems or data, answered with one tap on an option.
_Avoid_: Approval, prompt
