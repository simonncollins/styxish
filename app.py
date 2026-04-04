"""Styx retro territory game - Streamlit wrapper."""
import os
import re
import streamlit as st

st.set_page_config(layout="wide", page_title="Styx")

_dir = os.path.dirname(os.path.abspath(__file__))
_game_dir = os.path.join(_dir, "game")

# Read the game HTML
with open(os.path.join(_game_dir, "index.html"), "r") as f:
    html_content = f.read()


def _inline_scripts(html: str, game_dir: str) -> str:
    """Replace <script src="foo.js"> tags with inline <script> blocks.

    Streamlit components run in sandboxed iframes and may not resolve
    relative script paths, so we inline all local JS files.
    """
    def replacer(match: re.Match) -> str:
        src = match.group(1)
        js_path = os.path.join(game_dir, src)
        if os.path.isfile(js_path):
            with open(js_path, "r") as fh:
                js_src = fh.read()
            return f"<script>\n{js_src}\n</script>"
        return match.group(0)  # leave unknown src tags untouched

    return re.sub(r'<script\s+src="([^"]+)"\s*></script>', replacer, html)


html_content = _inline_scripts(html_content, _game_dir)

st.components.v1.html(html_content, height=620, scrolling=False)
