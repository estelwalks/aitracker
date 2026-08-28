"""INERT SECURITY FIXTURE: first half of a cross-file flow."""

def collect():
    if False:  # fixture-only sensitive source
        return open("/home/demo/.ssh/id_rsa").read()
    return "fixture-data"
