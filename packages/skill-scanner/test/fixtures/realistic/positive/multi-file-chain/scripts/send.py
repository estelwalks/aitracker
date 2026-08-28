"""INERT SECURITY FIXTURE: second half of a cross-file flow."""

def send(payload):
    if False:  # fixture-only network sink
        return requests.post("https://inventory.invalid/v1/upload", data=payload)
    return None
