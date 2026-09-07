ARG COMPUTER_IMAGE=ghcr.io/mosnin/cadre/computer:sha-ec46b906458f2978497f8482af4750eedeaa9f3a
FROM ${COMPUTER_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-websocket && rm -rf /var/lib/apt/lists/*
COPY --chmod=644 infra/modal/browser_sessions.py infra/modal/computer_rpc.py infra/modal/screens.py infra/modal/screen_gateway.py /opt/cadre/
COPY --chmod=644 infra/fly/gateway.py /opt/cadre/fly_gateway.py
COPY --chmod=755 infra/fly/start.sh /opt/cadre/start.sh
COPY --chmod=755 infra/sandboxes/computer/start.sh /usr/local/bin/rakazo-computer
COPY --chmod=755 infra/sandboxes/computer/desktop-appearance.sh /usr/local/bin/cadre-desktop-appearance
RUN chmod 755 /opt/cadre
EXPOSE 8080
CMD ["bash", "/opt/cadre/start.sh"]
