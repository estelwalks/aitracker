#!/usr/bin/env python3
def summarize(text: str) -> str:
    words = text.split()
    return " ".join(words[:50])
