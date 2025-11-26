import random
import time
from datetime import datetime
from paho.mqtt import client as mqtt_client

topic = "/boat/velocity"
client_id = f'publish-{random.randint(0, 1000)}'

BROKER = 'fae2c24a36ca4809b576ee0b22fa1667.s1.eu.hivemq.cloud'
PORT = 8883  

MQTT_USERNAME = "admin"  
MQTT_PASSWORD = "admin123barkA"

def connect_mqtt(client_id):
    client = mqtt_client.Client(
        client_id=client_id
    )

    client.username_pw_set(username=MQTT_USERNAME, password=MQTT_PASSWORD)
    
    client.tls_set(
        certfile=None,
        keyfile=None,
        cert_reqs=mqtt_client.ssl.CERT_REQUIRED,
        tls_version=mqtt_client.ssl.PROTOCOL_TLS
    )

    try:
        print(f"Attempting to connect to secure broker {BROKER}:{PORT}...")
        client.connect(BROKER, PORT)
        print("Connection successful (TLS enabled).")
        return client
    except Exception as e:
        print(f"Failed to connect to secure MQTT broker {BROKER}:{PORT}. Error: {e}")
        return None


def publish(client):
    msg_count = 1
    while True:
        time.sleep(0.5)
        current_timestamp = datetime.now().isoformat()
        velocity_value = random.uniform(0, 30)
        msg = '{"timestamp": "%s", "velocity": %.2f}' % (current_timestamp, velocity_value)
        
        result = client.publish(topic, msg)
        status = result[0]
        
        if status == 0:
            print(f"Send `{msg}` to topic `{topic}`")
        else:
            print(f"Failed to send message to topic {topic}")
        
        msg_count += 1
        if msg_count > 500:
            break


def run():
    client = connect_mqtt(client_id=client_id)
    client.loop_start()
    publish(client)
    client.loop_stop()


if __name__ == '__main__':
    run()
