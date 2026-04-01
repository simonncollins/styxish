"""Styx retro territory game - Streamlit wrapper."""
import os
import streamlit as st

st.set_page_config(layout="wide", page_title="Styx")

# Read the game HTML and embed it
_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_dir, "game", "index.html"), "r") as f:
    html_content = f.read()

st.components.v1.html(html_content, height=620, scrolling=False)
